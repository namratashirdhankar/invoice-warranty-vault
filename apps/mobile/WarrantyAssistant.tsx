import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Notifications from 'expo-notifications';

type Product = { id: string; name: string; brand?: string; model?: string };
type Message = { role: 'user' | 'assistant'; content: string; photos?: { uri: string; name: string }[] };
type Photo = { uri: string; name: string; type: string; size?: number };
type Reminder = { note: string; date: Date };

export default function WarrantyAssistant({ apiUrl, token, products, initialProductId, darkMode }: { apiUrl: string; token: string; products: Product[]; initialProductId: string; darkMode: boolean }) {
  const [productId, setProductId] = useState(initialProductId);
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: 'Tell me which product you need help with, what went wrong, and your country or region. You can attach up to five photos. I’ll look for the manufacturer’s official warranty/support page, ask follow-up questions, and help prepare a claim. I cannot submit it for you.' }]);
  const [input, setInput] = useState('');
  const [pendingPhotos, setPendingPhotos] = useState<Photo[]>([]);
  const [evidencePhotos, setEvidencePhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reminderCandidate, setReminderCandidate] = useState<Reminder | null>(null);
  const styles = createStyles(darkMode);

  useEffect(() => { if (initialProductId) setProductId(initialProductId); }, [initialProductId]);

  async function attachPhotos() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp'], multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      const selected = result.assets.map(asset => ({ uri: asset.uri, name: asset.name || 'warranty-photo.jpg', type: asset.mimeType || 'image/jpeg', size: asset.size }));
      const total = evidencePhotos.length + pendingPhotos.length + selected.length;
      if (total > 5) { setError('A chat can include up to five photos. Clear the chat to start with new photos.'); return; }
      if (selected.some(photo => !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) || (photo.size || 0) > 4 * 1024 * 1024)) { setError('Use JPEG, PNG, or WebP photos, each no larger than 4 MB.'); return; }
      setError(''); setPendingPhotos(current => [...current, ...selected]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open your photos.'); }
  }

  async function sendMessage() {
    const text = input.trim();
    if ((!text && !pendingPhotos.length) || loading) return;
    const message = text || 'Please inspect these product/issue photos and help me with a warranty claim.';
    const allPhotos = [...evidencePhotos, ...pendingPhotos];
    const history = messages.map(item => ({ role: item.role, content: item.content + (item.photos?.length ? ` [Attached photos: ${item.photos.map(photo => photo.name).join(', ')}]` : '') })).slice(-10);
    const userTurn: Message = { role: 'user', content: message, photos: pendingPhotos.map(photo => ({ uri: photo.uri, name: photo.name })) };
    setMessages(current => [...current, userTurn]);
    setInput(''); setPendingPhotos([]); setEvidencePhotos(allPhotos); setError(''); setLoading(true);
    try {
      const form = new FormData();
      form.append('message', message);
      form.append('history', JSON.stringify(history));
      if (productId) form.append('productId', productId);
      allPhotos.forEach((photo, index) => form.append('photos', { uri: photo.uri, name: photo.name || `photo-${index + 1}.jpg`, type: photo.type } as unknown as Blob));
      const answer = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl + '/assistant/chat');
        xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.onload = () => {
          try {
            const response = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(response.answer || 'I could not prepare a response. Please try again.');
            else reject(new Error(response.message || 'The assistant request failed.'));
          } catch { reject(new Error('Invalid response from the assistant.')); }
        };
        xhr.onerror = () => reject(new Error('Network error. Check that your phone can reach the API server.'));
        xhr.send(form);
      });
      setMessages(current => [...current, { role: 'assistant', content: answer }]);
      const reminder = parseReminder(message);
      if (reminder) setReminderCandidate(reminder);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not reach the assistant.'); }
    finally { setLoading(false); }
  }

  async function confirmReminder() {
    if (!reminderCandidate) return;
    try {
      const permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) { setError('Allow notifications in your device settings to receive reminders.'); return; }
      await Notifications.scheduleNotificationAsync({ content:{title:'Warranty follow-up',body:reminderCandidate.note,data:{type:'claim-follow-up'}}, trigger:{type:Notifications.SchedulableTriggerInputTypes.DATE,date:reminderCandidate.date} });
      setMessages(current => [...current,{role:'assistant',content:`Reminder set for ${reminderCandidate.date.toLocaleString()}: ${reminderCandidate.note}`}]);
      setReminderCandidate(null);setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not schedule the reminder.'); }
  }

  function clearChat() {
    setMessages([{ role: 'assistant', content: 'Tell me which product you need help with, what went wrong, and your country or region. You can attach up to five photos. I’ll look for the manufacturer’s official warranty/support page, ask follow-up questions, and help prepare a claim. I cannot submit it for you.' }]);
    setInput(''); setPendingPhotos([]); setEvidencePhotos([]); setError('');setReminderCandidate(null);
  }

  return <View style={styles.container}>
    <View style={styles.header}><View style={{ flex: 1 }}><Text style={styles.eyebrow}>WARRANTY CLAIM CHAT</Text><Text style={styles.title}>How can I help?</Text><Text style={styles.caption}>Also say “remind me to follow up in 3 days” or “remind me to call support on 2026-12-01 at 09:00”; confirm to schedule.</Text></View><TouchableOpacity onPress={clearChat}><Text style={styles.clear}>New chat</Text></TouchableOpacity></View>
    <Text style={styles.label}>PRODUCT (OPTIONAL)</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.products}>
      <TouchableOpacity onPress={() => setProductId('')} style={[styles.productChip, !productId && styles.productChipSelected]}><Text style={[styles.productChipText, !productId && styles.productChipTextSelected]}>Choose in chat</Text></TouchableOpacity>
      {products.map(product => <TouchableOpacity key={product.id} onPress={() => setProductId(product.id)} style={[styles.productChip, productId === product.id && styles.productChipSelected]}><Text style={[styles.productChipText, productId === product.id && styles.productChipTextSelected]}>{product.name}</Text></TouchableOpacity>)}
    </ScrollView>
    <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent} keyboardShouldPersistTaps="handled">
      {messages.map((message, index) => <View key={`${index}-${message.role}`} style={[styles.message, message.role === 'user' ? styles.userMessage : styles.assistantMessage]}><Text style={[styles.messageText, message.role === 'user' && styles.userMessageText]}>{message.content}</Text>{!!message.photos?.length && <View style={styles.thumbnails}>{message.photos.map(photo => <View key={photo.uri} style={styles.thumbnailWrap}><Image source={{ uri: photo.uri }} style={styles.thumbnail} /><Text style={styles.photoName} numberOfLines={1}>{photo.name}</Text></View>)}</View>}</View>)}
      {loading && <View style={[styles.message, styles.assistantMessage, styles.loading]}><ActivityIndicator size="small"/><Text style={styles.messageText}>Checking official warranty information…</Text></View>}
      {!!reminderCandidate && <View style={styles.reminderCard}><Text style={styles.reminderTitle}>Schedule this reminder?</Text><Text style={styles.messageText}>{reminderCandidate.note}</Text><Text style={styles.caption}>{reminderCandidate.date.toLocaleString()} · local device notification</Text><TouchableOpacity onPress={confirmReminder} style={styles.sendButton}><Text style={styles.sendText}>Confirm reminder</Text></TouchableOpacity></View>}
    </ScrollView>
    {!!pendingPhotos.length && <View style={styles.pending}><Text style={styles.label}>PHOTOS TO SEND</Text><View style={styles.thumbnails}>{pendingPhotos.map(photo => <View key={photo.uri} style={styles.thumbnailWrap}><Image source={{ uri: photo.uri }} style={styles.thumbnail} /><TouchableOpacity onPress={() => setPendingPhotos(current => current.filter(item => item.uri !== photo.uri))}><Text style={styles.remove}>Remove</Text></TouchableOpacity></View>)}</View></View>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <View style={styles.composer}><TextInput style={styles.input} value={input} onChangeText={setInput} placeholder="Describe the product and issue…" placeholderTextColor={darkMode ? '#96a7bd' : '#77849a'} multiline maxLength={2000} editable={!loading} textAlignVertical="top"/><View style={styles.actions}><TouchableOpacity disabled={loading} onPress={attachPhotos} style={styles.photoButton}><Text style={styles.photoButtonText}>＋ Photo</Text></TouchableOpacity><Text style={styles.helper}>{evidencePhotos.length + pendingPhotos.length}/5 photos</Text><TouchableOpacity disabled={loading || (!input.trim() && !pendingPhotos.length)} onPress={sendMessage} style={[styles.sendButton, (loading || (!input.trim() && !pendingPhotos.length)) && styles.disabled]}><Text style={styles.sendText}>{loading ? '…' : 'Send  ↑'}</Text></TouchableOpacity></View></View>
    <Text style={styles.disclaimer}>AI guidance can be wrong. Check the linked manufacturer terms and review every claim before sending. Never share passwords or OTPs.</Text>
  </View>;
}

function parseReminder(input: string): Reminder | null {
  const relativeAfter = input.match(/remind me(?: to)? (.+?) in (\d{1,3}) days?/i);
  const relativeBefore = input.match(/remind me in (\d{1,3}) days? to (.+)/i);
  const absolute = input.match(/remind me(?: to)? (.+?) on (\d{4}-\d{2}-\d{2})(?: at (\d{1,2}):(\d{2}))?/i);
  let note = ''; let date: Date;
  if (relativeAfter || relativeBefore) {
    const count = Number(relativeAfter ? relativeAfter[2] : relativeBefore![1]);
    note = relativeAfter ? relativeAfter[1] : relativeBefore![2];
    if (count < 1 || count > 365) return null;
    date = new Date(); date.setDate(date.getDate() + count); date.setHours(9,0,0,0);
  } else if (absolute) {
    note = absolute[1]; const [year,month,day] = absolute[2].split('-').map(Number); const hour=Number(absolute[3]||9), minute=Number(absolute[4]||0);
    date = new Date(year,month-1,day,hour,minute,0,0);
    if (date.getFullYear()!==year || date.getMonth()!==month-1 || date.getDate()!==day || hour>23 || minute>59) return null;
  } else return null;
  if (!note.trim() || date.getTime() <= Date.now()) return null;
  return {note:note.trim(),date};
}

function createStyles(dark: boolean) {
  const text = dark ? '#f2f5fb' : '#17243c'; const muted = dark ? '#a9b7cb' : '#627087'; const surface = dark ? '#1b2738' : '#fff'; const border = dark ? '#34445a' : '#dce3ee'; const accent = dark ? '#769cff' : '#2659d9';
  return StyleSheet.create({ container:{gap:12}, header:{flexDirection:'row',alignItems:'center',gap:12}, eyebrow:{fontSize:10,letterSpacing:1.3,fontWeight:'800',color:accent}, title:{fontSize:23,fontWeight:'800',color:text,marginTop:3}, caption:{fontSize:13,color:muted,marginTop:3,lineHeight:19}, clear:{color:accent,fontWeight:'700'}, label:{fontSize:10,letterSpacing:1,fontWeight:'800',color:muted}, products:{gap:8,paddingBottom:3}, productChip:{borderWidth:1,borderColor:border,borderRadius:18,paddingVertical:8,paddingHorizontal:12,backgroundColor:surface}, productChipSelected:{borderColor:accent,backgroundColor:dark?'#203552':'#eaf0ff'}, productChipText:{fontSize:12,color:text}, productChipTextSelected:{color:accent,fontWeight:'700'}, transcript:{maxHeight:420,minHeight:230,borderWidth:1,borderColor:border,borderRadius:16,backgroundColor:dark?'#121d2b':'#f5f7fb'}, transcriptContent:{padding:12,gap:10}, message:{maxWidth:'92%',borderRadius:15,padding:12,gap:8}, userMessage:{alignSelf:'flex-end',backgroundColor:accent,borderBottomRightRadius:4}, assistantMessage:{alignSelf:'flex-start',backgroundColor:surface,borderWidth:1,borderColor:border,borderBottomLeftRadius:4}, messageText:{fontSize:14,lineHeight:20,color:text}, userMessageText:{color:'#fff'}, loading:{flexDirection:'row',alignItems:'center',gap:8}, thumbnails:{flexDirection:'row',flexWrap:'wrap',gap:8}, thumbnailWrap:{width:78,gap:3}, thumbnail:{width:72,height:68,borderRadius:8,backgroundColor:border}, photoName:{fontSize:9,color:muted}, pending:{gap:6}, remove:{fontSize:10,color:accent}, composer:{padding:10,borderWidth:1,borderColor:border,borderRadius:16,backgroundColor:surface,gap:8}, input:{minHeight:54,maxHeight:130,fontSize:15,color:text,padding:4}, actions:{flexDirection:'row',alignItems:'center',gap:10}, photoButton:{paddingVertical:9,paddingHorizontal:12,borderRadius:10,backgroundColor:dark?'#26374e':'#edf1f8'}, photoButtonText:{fontWeight:'700',color:accent}, helper:{flex:1,fontSize:11,color:muted}, sendButton:{paddingVertical:10,paddingHorizontal:15,borderRadius:11,backgroundColor:accent}, disabled:{opacity:0.5}, sendText:{fontWeight:'800',color:'#fff'}, error:{color:dark?'#ff9a9a':'#b42318',fontSize:13}, reminderCard:{alignSelf:'stretch',borderRadius:14,padding:13,backgroundColor:dark?'#203552':'#eaf0ff',gap:7},reminderTitle:{fontSize:14,fontWeight:'800' as const,color:text},disclaimer:{fontSize:11,lineHeight:16,color:muted,marginBottom:6}
  });
}
