import React, { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Linking } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
type Item = { name: string; brand?: string; warrantyEndDate?: string; warrantyMonths?: number };
export default function App() {
  const [token, setToken] = useState('');
  const [restoring,setRestoring] = useState(true);
  useEffect(()=>{ SecureStore.getItemAsync('vault_token').then(v=>{ if(v) setToken(v); }).catch(()=>{}).finally(()=>setRestoring(false)); },[]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tab, setTab] = useState('products');
  const [products, setProducts] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [expiring, setExpiring] = useState<any[]>([]);
  const [draft, setDraft] = useState<any>(null);
  const [invoiceId, setInvoiceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [question,setQuestion] = useState('');
  const [answer,setAnswer] = useState('');
  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(API + path, { ...options, headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Request failed');
    return result;
  }
  async function auth(action: 'register'|'login') {
    setBusy(true);
    try {
      const response = await fetch(API + '/auth/' + action, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Authentication failed');
      await SecureStore.setItemAsync('vault_token',data.token);
      setToken(data.token);
    } catch(e) { Alert.alert('Sign in', String(e)); } finally { setBusy(false); }
  }
  async function refresh() {
    try {
      const [p,i,w] = await Promise.all([request('/products'),request('/invoices'),request('/warranties/expiring?days=30')]);
      setProducts(p); setInvoices(i); setExpiring(w);
    } catch(e) { Alert.alert('Unable to load', String(e)); }
  }
  useEffect(() => { if (token) refresh(); }, [token]);
  async function upload() {
    const selected = await DocumentPicker.getDocumentAsync({ type:['application/pdf','image/jpeg','image/png'],copyToCacheDirectory:true });
    if (selected.canceled) return;
    const file = selected.assets[0];
    const form = new FormData();
    form.append('file', { uri:file.uri,name:file.name,type:file.mimeType || 'application/pdf' } as any);
    setBusy(true);
    try {
      const result = await request('/invoices/upload', { method:'POST',body:form });
      setInvoiceId(result.id);
      try {
        const extracted = await request('/invoices/' + result.id + '/extract', { method:'POST' });
        setDraft({ ...extracted.preview, items: extracted.preview.items?.length ? extracted.preview.items : [{ name:'' }] });
        setTab('review');
      } catch {
        setDraft({ invoiceNumber:'',seller:'',purchaseDate:'',items:[{name:''}] });
        setTab('review');
        Alert.alert('Manual review', 'AI extraction unavailable. Enter your purchase details manually.');
      }
    } catch(e) { Alert.alert('Upload failed',String(e)); } finally { setBusy(false); }
  }
  async function askAssistant() {
    if (!question.trim()) return;
    setBusy(true);
    try {
      const response = await request('/assistant/ask', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({question}) });
      setAnswer(response.answer);
    } catch(e) { Alert.alert('Assistant error',String(e)); } finally { setBusy(false); }
  }
  async function enableReminders() {
    try {
      const permission = await Notifications.requestPermissionsAsync();
      if (permission.status !== 'granted') { Alert.alert('Notifications disabled','Enable notifications in your phone settings.'); return; }
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId) { Alert.alert('Expo setup needed','Configure the EAS project ID in app.json to enable device push notifications.'); return; }
      const push = await Notifications.getExpoPushTokenAsync({ projectId });
      await request('/notifications/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:push.data})});
      Alert.alert('Reminders enabled','Your device is registered for warranty reminders.');
    } catch(e) { Alert.alert('Unable to enable reminders',String(e)); }
  }
  async function openInvoice(id:string) {
    try {
      const response = await fetch(API + '/invoices/' + id + '/download-link', { headers:{Authorization:'Bearer '+token} });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to open invoice');
      await Linking.openURL(data.url);
    } catch(e) { Alert.alert('Open invoice',String(e)); }
  }
  async function confirm() {
    setBusy(true);
    try {
      await request('/invoices/' + invoiceId + '/confirm', { method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(draft) });
      setDraft(null);setTab('products');await refresh();
      Alert.alert('Saved','Invoice and products saved.');
    } catch(e) { Alert.alert('Unable to save',String(e)); } finally { setBusy(false); }
  }
  const field = (label:string,value:string,onChange:(s:string)=>void) => <View style={{marginBottom:12}}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} value={value || ''} onChangeText={onChange} placeholder={label} autoCapitalize="none" /></View>;
  const button = (label:string,onPress:()=>void) => <TouchableOpacity disabled={busy} style={styles.button} onPress={onPress}><Text style={styles.buttonText}>{label}</Text></TouchableOpacity>;
  if (restoring) return <SafeAreaView style={styles.root}><Text style={styles.title}>Loading Invoice Vault…</Text></SafeAreaView>;
  if (!token) return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.body}><StatusBar style="dark"/><Text style={styles.title}>Invoice Vault</Text><Text style={styles.subtitle}>Your purchases and warranties in one place.</Text>{field('Email',email,setEmail)}{field('Password (10+ characters)',password,setPassword)}{button('Sign in',()=>auth('login'))}{button('Create account',()=>auth('register'))}</ScrollView></SafeAreaView>;
  return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.body}><StatusBar style="dark"/><Text style={styles.title}>Invoice Vault</Text><Text style={styles.subtitle}>{products.length} products · {expiring.length} warranties expiring within 30 days</Text>
    <View style={styles.tabs}>{['products','invoices','assistant','review'].filter(x=>x!=='review'||draft).map(t=><TouchableOpacity key={t} onPress={()=>setTab(t)} style={[styles.tab,tab===t&&styles.selected]}><Text style={{color:tab===t?'white':'#223'}}>{t.toUpperCase()}</Text></TouchableOpacity>)}</View>
    {tab==='products' && <>{button('+ Upload invoice',upload)}{button('Refresh',refresh)}{button('Enable warranty reminders',enableReminders)}{products.map(p=><View key={p.id} style={styles.card}><Text style={styles.heading}>{p.name}</Text><Text>{[p.brand,p.model].filter(Boolean).join(' · ')}</Text>{p.items.map((it:any)=><Text key={it.id} style={styles.note}>Warranty: {it.warranty?.expiresAt ? new Date(it.warranty.expiresAt).toLocaleDateString() : 'Not recorded'}</Text>)}{p.support.map((s:any)=><Text key={s.id} onPress={()=>s.phone&&Linking.openURL('tel:'+s.phone)} style={styles.link}>{s.name}: {s.phone || s.website || s.email}</Text>)}</View>)}</>}
    {tab==='assistant' && <View style={styles.card}><Text style={styles.heading}>Ask about your purchases</Text>{field('Your question',question,setQuestion)}{button('Ask AI',askAssistant)}{!!answer && <Text style={styles.note}>{answer}</Text>}</View>}
    {tab==='invoices' && invoices.map(i=><View key={i.id} style={styles.card}><Text style={styles.heading}>{i.seller || 'Invoice'} {i.invoiceNumber || ''}</Text><Text>{i.status} · {i.items.length} items</Text><Text style={styles.link} onPress={()=>openInvoice(i.id)}>View original invoice</Text></View>)}
    {tab==='review' && draft && <><Text style={styles.heading}>Review invoice details</Text>{field('Invoice number',draft.invoiceNumber,(v)=>setDraft({...draft,invoiceNumber:v}))}{field('Seller',draft.seller,(v)=>setDraft({...draft,seller:v}))}{field('Purchase date (YYYY-MM-DD)',draft.purchaseDate,(v)=>setDraft({...draft,purchaseDate:v}))}{draft.items.map((it:Item,index:number)=><View key={index} style={styles.card}><Text style={styles.heading}>Product {index+1}</Text>{field('Product name',it.name,(v)=>changeItem(index,'name',v))}{field('Brand',it.brand||'',(v)=>changeItem(index,'brand',v))}{field('Warranty expiry YYYY-MM-DD',it.warrantyEndDate||'',(v)=>changeItem(index,'warrantyEndDate',v))}</View>)}{button('Add another product',()=>setDraft({...draft,items:[...draft.items,{name:''}]}))}{button('Confirm and save',confirm)}</>}
    <TouchableOpacity onPress={async()=>{await SecureStore.deleteItemAsync('vault_token');setToken('');setProducts([]);setInvoices([]);}}><Text style={styles.link}>Sign out</Text></TouchableOpacity>
  </ScrollView></SafeAreaView>;
  function changeItem(index:number,key:string,value:string) { setDraft((previous:any)=>({...previous,items:previous.items.map((item:any,i:number)=>i===index?{...item,[key]:value}:item)})); }
}
const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:'#f7f9fc'},body:{padding:24,gap:16},title:{fontSize:30,fontWeight:'800',color:'#17243c',marginTop:24},
  subtitle:{fontSize:15,color:'#627087',lineHeight:22},label:{fontSize:13,color:'#627087',marginBottom:5},
  input:{backgroundColor:'white',borderColor:'#dce3ee',borderWidth:1,padding:12,borderRadius:10,color:'#17243c'},
  button:{backgroundColor:'#2659d9',padding:16,borderRadius:14,alignItems:'center'},
  buttonText:{color:'white',fontWeight:'700',fontSize:15},heading:{fontSize:18,fontWeight:'700',color:'#17243c'},
  card:{backgroundColor:'white',padding:16,borderRadius:14,gap:8},note:{color:'#627087'},link:{color:'#2659d9',marginTop:8},
  tabs:{flexDirection:'row',gap:8},tab:{padding:10,borderRadius:10,backgroundColor:'#e6eaf1'},selected:{backgroundColor:'#2659d9'}
});
