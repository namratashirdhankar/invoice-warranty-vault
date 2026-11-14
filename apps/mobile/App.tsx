import React, { useState } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { StatusBar } from 'expo-status-bar';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
export default function App() {
  const [busy, setBusy] = useState(false);
  async function upload() {
    const selected = await DocumentPicker.getDocumentAsync({ type: ['application/pdf','image/jpeg','image/png'], copyToCacheDirectory: true });
    if (selected.canceled) return;
    const file = selected.assets[0];
    const form = new FormData();
    form.append('file', { uri: file.uri, name: file.name, type: file.mimeType || 'application/pdf' } as any);
    setBusy(true);
    try {
      const response = await fetch(API + '/invoices/upload', { method: 'POST', body: form });
      if (!response.ok) throw new Error('Upload failed (' + response.status + ')');
      Alert.alert('Invoice uploaded', 'File staged successfully. AI extraction and permanent saving will be added next.');
    } catch (error) {
      Alert.alert('Upload error', String(error));
    } finally { setBusy(false); }
  }
  return <SafeAreaView style={styles.root}><StatusBar style="dark"/><ScrollView contentContainerStyle={styles.body}>
    <Text style={styles.title}>Invoice Vault</Text>
    <Text style={styles.subtitle}>Your purchases, invoices and warranties in one place.</Text>
    <View style={styles.panel}><Text style={styles.heading}>Never miss a warranty</Text><Text style={styles.note}>Upload a receipt and keep the original ready for future claims.</Text></View>
    <TouchableOpacity style={styles.button} disabled={busy} onPress={upload}><Text style={styles.buttonText}>{busy ? 'Uploading…' : '+ Upload invoice'}</Text></TouchableOpacity>
    <Text style={styles.section}>Coming next</Text>
    {['AI invoice extraction & review','My products & original invoices','Warranty expiry reminders','Verified customer care contacts','Ask AI about your purchases'].map(t => <View key={t} style={styles.item}><Text style={styles.itemText}>•  {t}</Text></View>)}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  root:{flex:1,backgroundColor:'#f7f9fc'},body:{padding:24,gap:16},
  title:{fontSize:30,fontWeight:'800',color:'#17243c',marginTop:24},
  subtitle:{fontSize:15,color:'#627087',lineHeight:22},
  panel:{backgroundColor:'#e9f1ff',borderRadius:18,padding:22,marginTop:12},
  heading:{fontSize:19,fontWeight:'700',color:'#17243c'},note:{marginTop:8,color:'#536780',lineHeight:21},
  button:{backgroundColor:'#2659d9',padding:18,borderRadius:14,alignItems:'center'},
  buttonText:{color:'#fff',fontWeight:'700',fontSize:16},
  section:{fontSize:20,fontWeight:'700',marginTop:18,color:'#17243c'},
  item:{backgroundColor:'#fff',borderRadius:12,padding:17},itemText:{fontSize:15,color:'#263955'}
});
