import React, { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Linking, ActivityIndicator, Share, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import WarrantyAssistant from './WarrantyAssistant';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Google from 'expo-auth-session/providers/google';
import { exchangeCodeAsync } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { StatusBar } from 'expo-status-bar';

WebBrowser.maybeCompleteAuthSession();

function apiUrl(): string {
  const value = (Constants.expoConfig?.extra?.apiUrl as string | undefined)?.trim();
  if (!value) throw new Error('This app was built without API_URL. Set API_URL in the selected EAS build environment, rebuild, and install the new APK. For local Expo, set apps/mobile/.env and restart Expo.');
  if (!/^https?:\/\/[^/\s?#]+(?:\/[^\s?#]*)?\/?$/i.test(value)) throw new Error('API_URL must be a valid HTTP or HTTPS URL.');
  return value.replace(/\/+$/, '');
}
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The API did not respond within 15 seconds. Check API_URL and make sure the API server is running and reachable from your phone.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
type Item = { name: string; brand?: string; warrantyStartDate?: string; warrantyEndDate?: string; warrantyMonths?: number | string };

function dateOnly(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

type ProductFilter = 'all' | 'active' | 'soon' | 'expired' | 'none';

function productWarrantyFilter(product: any): Exclude<ProductFilter, 'all'> {
  const dates = (product.items || []).map((item: any) => item.warranty?.expiresAt).filter(Boolean).map((value: string) => new Date(value).getTime()).filter(Number.isFinite);
  if (!dates.length) return 'none';
  if (dates.some((time: number) => time >= Date.now() && time - Date.now() <= 30 * 86400000)) return 'soon';
  if (dates.some((time: number) => time >= Date.now())) return 'active';
  return 'expired';
}

function normalizeDuplicateKey(value: unknown): string {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\\s\\p{P}\\p{S}]+/gu, '');
}

function warrantyPreview(item: Item, purchaseDate: string): string {
  if (item.warrantyEndDate) return 'The entered expiry date will be saved instead of a calculated date.';
  const rawMonths = String(item.warrantyMonths ?? '').trim();
  if (!rawMonths) return 'No expiry estimate: enter a warranty duration or expiry date if stated.';
  const months = Number(rawMonths);
  if (!/^\d+$/.test(rawMonths) || !Number.isSafeInteger(months) || months < 1 || months > 1200) return 'Enter a whole number of months between 1 and 1200.';
  const start = dateOnly(item.warrantyStartDate || purchaseDate);
  if (!start) return 'No expiry estimate: enter a valid warranty start date or purchase date (YYYY-MM-DD).';
  start.setUTCMonth(start.getUTCMonth() + months);
  return `Estimated expiry: ${start.toISOString().slice(0, 10)}. ${item.warrantyStartDate ? 'Based on the entered warranty start date.' : 'Assumes the warranty starts on the purchase date; it may start on delivery, installation, or activation instead.'} Verify the warranty terms before saving.`;
}
export default function App() {
  const googleConfig = (Constants.expoConfig?.extra?.googleAuth || {}) as {webClientId?:string;androidClientId?:string;iosClientId?:string};
  const [googleRequest,,googlePromptAsync] = Google.useIdTokenAuthRequest({clientId:googleConfig.webClientId||'not-configured.apps.googleusercontent.com',webClientId:googleConfig.webClientId,androidClientId:googleConfig.androidClientId,iosClientId:googleConfig.iosClientId,selectAccount:false,shouldAutoExchangeCode:false},{scheme:typeof Constants.expoConfig?.scheme==='string'?Constants.expoConfig.scheme:'invoicevault'});
  const [token, setToken] = useState('');
  const [restoring,setRestoring] = useState(true);
  useEffect(()=>{ SecureStore.getItemAsync('vault_token').then(v=>{ if(v) setToken(v); }).catch(()=>{}).finally(()=>setRestoring(false)); },[]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login'|'register'>('login');
  const [tab, setTab] = useState('products');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(()=>{ SecureStore.getItemAsync('vault_theme').then(value=>{if(value==='light'||value==='dark')setTheme(value)}).catch(()=>{}); },[]);
  const darkMode = theme === 'dark';
  const styles = createStyles(darkMode);
  const [products, setProducts] = useState<any[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [productFilter, setProductFilter] = useState<ProductFilter>('all');
  const [invoices, setInvoices] = useState<any[]>([]);
  const [expiring, setExpiring] = useState<any[]>([]);
  const [draft, setDraft] = useState<any>(null);
  const [invoiceId, setInvoiceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [authAction,setAuthAction] = useState<'login'|'register'|'google'|null>(null);
  const [sharingInvoiceId,setSharingInvoiceId] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [question,setQuestion] = useState('');
  const [answer,setAnswer] = useState('');
  const [assistantLoading,setAssistantLoading] = useState(false);
  const [assistantError,setAssistantError] = useState('');
  const [supportProductId,setSupportProductId] = useState('');
  const [supportName,setSupportName] = useState('');
  const [supportPhone,setSupportPhone] = useState('');
  const [supportEmail,setSupportEmail] = useState('');
  const [supportWebsite,setSupportWebsite] = useState('');
  const [supportSource,setSupportSource] = useState('');
  const [supportSaving,setSupportSaving] = useState(false);
  const [claimProductId,setClaimProductId] = useState('');
  const [claimIssue,setClaimIssue] = useState('');
  const [claimNoticedOn,setClaimNoticedOn] = useState('');
  const [claimSteps,setClaimSteps] = useState('');
  const [claimDraft,setClaimDraft] = useState('');
  const [claimLoading,setClaimLoading] = useState(false);
  const [claimError,setClaimError] = useState('');
  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(apiUrl() + path, { ...options, headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Request failed');
    return result;
  }
  async function auth(action: 'register'|'login') {
    setAuthAction(action);setBusy(true);
    try {
      const response = await fetchWithTimeout(apiUrl() + '/auth/' + action, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Authentication failed');
      await SecureStore.setItemAsync('vault_token',data.token);
      setToken(data.token);
    } catch(e) { Alert.alert('Sign in', String(e)); } finally { setBusy(false);setAuthAction(null); }
  }
  async function googleLogin() {
    const platformClientId=Platform.OS==='ios'?googleConfig.iosClientId:Platform.OS==='android'?googleConfig.androidClientId:googleConfig.webClientId;
    const missing = [!googleConfig.webClientId && 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', !platformClientId && (Platform.OS === 'ios' ? 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID' : Platform.OS === 'android' ? 'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID' : 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID')].filter(Boolean);
    if (missing.length) { Alert.alert('Google sign-in setup required',`Missing build settings: ${Array.from(new Set(missing)).join(', ')}. Set them in the selected EAS build environment, rebuild, and install the new app. For local Expo, use apps/mobile/.env and restart Expo.`); return; }
    if (!googleRequest) { Alert.alert('Google sign-in', 'Google sign-in is still initializing. Please try again in a moment.'); return; }
    setAuthAction('google');setBusy(true);
    try {
      const backendUrl = apiUrl();
      const result = await googlePromptAsync();
      if (result.type !== 'success') return;
      // Native Google login returns a code. Exchange it before reading the ID token;
      // promptAsync returns before the provider's automatic exchange would complete.
      let idToken = result.params?.id_token || result.authentication?.idToken;
      if (!idToken && result.params?.code) {
        const authentication = await exchangeCodeAsync({
          clientId: platformClientId,
          code: result.params.code,
          redirectUri: googleRequest.redirectUri,
          extraParams: googleRequest.codeVerifier ? { code_verifier: googleRequest.codeVerifier } : {},
        }, Google.discovery);
        idToken = authentication.idToken;
      }
      if (!idToken) throw new Error('Google did not return an ID token. Check the OAuth client configuration.');
      const response = await fetchWithTimeout(backendUrl + '/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Google sign-in failed');
      await SecureStore.setItemAsync('vault_token',data.token);setToken(data.token);
    } catch(error) { Alert.alert('Google sign-in',error instanceof Error?error.message:String(error)); }
    finally { setBusy(false);setAuthAction(null); }
  }
  async function shareInvoice(invoice:any) {
    setSharingInvoiceId(invoice.id);
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device');
      const cache = FileSystem.cacheDirectory;
      if (!cache) throw new Error('Could not access temporary storage');
      const mimeType = invoice.mimeType || 'application/pdf';
      const extension = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
      const target = `${cache}invoice-${invoice.id}-${Date.now()}.${extension}`;
      const downloaded = await FileSystem.downloadAsync(`${apiUrl()}/invoices/${invoice.id}/file`,target,{headers:{Authorization:`Bearer ${token}`}});
      if (downloaded.status < 200 || downloaded.status >= 300) throw new Error(`Could not download invoice (HTTP ${downloaded.status})`);
      await Sharing.shareAsync(downloaded.uri,{mimeType,dialogTitle:'Share invoice file',UTI:mimeType==='application/pdf'?'com.adobe.pdf':'public.image'});
    } catch (error) { Alert.alert('Could not share invoice file',error instanceof Error?error.message:String(error)); }
    finally { setSharingInvoiceId(''); }
  }
  async function deleteInvoice(invoice:any) {
    Alert.alert('Delete invoice?', 'This permanently deletes the invoice file and its warranty records. Products used by other invoices will be kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await request('/invoices/' + invoice.id, { method: 'DELETE' }); await refresh(); Alert.alert('Deleted', 'Invoice removed.'); }
        catch (error) { Alert.alert('Could not delete invoice', String(error)); }
      } },
    ]);
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
    setUploadStatus('Uploading invoice…');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', { uri: file.uri, name: file.name, type: file.mimeType || 'application/pdf' } as unknown as Blob);
      // React Native's XMLHttpRequest supports local file URIs; Expo fetch does not.
      const result = await new Promise<{ id: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl() + '/invoices/upload');
        xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(data);
            else reject(new Error(data.message || 'Upload failed'));
          } catch { reject(new Error('Invalid server response')); }
        };
        xhr.onerror = () => reject(new Error('Network error while uploading'));
        xhr.send(form);
      });
      setInvoiceId(result.id);
      setUploadStatus('Reading invoice details with AI…');
      try {
        const extracted = await request('/invoices/' + result.id + '/extract', { method:'POST' });
        setDraft({ ...extracted.preview, items: extracted.preview.items?.length ? extracted.preview.items : [{ name:'' }] });
        setTab('review');
      } catch {
        setDraft({ invoiceNumber:'',seller:'',purchaseDate:'',items:[{name:''}] });
        setTab('review');
        Alert.alert('Manual review', 'AI extraction unavailable. Enter your purchase details manually.');
      }
    } catch(e) { Alert.alert('Upload failed',String(e)); } finally { setUploadStatus(''); setBusy(false); }
  }
  async function saveSupportContact(productId:string) {
    if (!supportName.trim() || !(supportPhone.trim() || supportEmail.trim() || supportWebsite.trim())) { Alert.alert('Contact details needed','Enter a contact name and at least a phone, email, or website.'); return; }
    setSupportSaving(true);
    try {
      await request(`/products/${productId}/support`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:supportName.trim(),phone:supportPhone.trim()||undefined,email:supportEmail.trim()||undefined,website:supportWebsite.trim()||undefined,sourceUrl:supportSource.trim()||undefined})});
      setSupportProductId('');setSupportName('');setSupportPhone('');setSupportEmail('');setSupportWebsite('');setSupportSource('');await refresh();
    } catch(error) { Alert.alert('Could not save contact',error instanceof Error?error.message:String(error)); }
    finally { setSupportSaving(false); }
  }
  function startWarrantyClaim(product:any) {
    setClaimProductId(product.id);setClaimIssue('');setClaimNoticedOn('');setClaimSteps('');setClaimDraft('');setClaimError('');setTab('assistant');
  }
  async function generateClaimDraft() {
    if (!claimProductId || claimIssue.trim().length<5) { setClaimError('Choose a product and describe the issue in a little more detail.'); return; }
    setClaimLoading(true);setClaimError('');setClaimDraft('');
    try {
      const result=await request('/assistant/warranty-claim-draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:claimProductId,issue:claimIssue,noticedOn:claimNoticedOn||undefined,stepsTried:claimSteps||undefined})});
      setClaimDraft(result.draft);
    } catch(error) { setClaimError(error instanceof Error?error.message:'Could not create a claim draft. Try again.'); }
    finally { setClaimLoading(false); }
  }
  async function shareClaimDraft() {
    const product=products.find(item=>item.id===claimProductId);
    try { await Share.share({title:`Warranty claim — ${product?.name||'Product'}`,message:claimDraft}); }
    catch(error) { Alert.alert('Could not share draft',String(error)); }
  }
  async function askAssistant(prompt = question) {
    const cleaned = prompt.trim();
    if (!cleaned || assistantLoading) return;
    setQuestion(cleaned);
    setAssistantError('');
    setAnswer('');
    setAssistantLoading(true);
    try {
      const response = await request('/assistant/ask', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({question:cleaned}) });
      setAnswer(typeof response.answer === 'string' && response.answer.trim() ? response.answer.trim() : 'I could not find an answer in your saved purchase details.');
    } catch(e) { setAssistantError(e instanceof Error ? e.message : 'Could not reach the assistant. Check your connection and try again.'); }
    finally { setAssistantLoading(false); }
  }
  async function enableReminders() {
    try {
      const permission = await Notifications.requestPermissionsAsync();
      if (permission.status !== 'granted') { Alert.alert('Notifications disabled','Allow notifications in your phone settings, then try again.'); return; }
      const previousIds = await SecureStore.getItemAsync('vault_local_reminder_ids');
      if (previousIds) for (const id of JSON.parse(previousIds) as string[]) await Notifications.cancelScheduledNotificationAsync(id);
      const reminders: { title: string; body: string; date: Date }[] = [];
      for (const product of products) for (const item of product.items || []) {
        const expiry = item.warranty?.expiresAt ? new Date(item.warranty.expiresAt) : null;
        if (!expiry || Number.isNaN(expiry.getTime())) continue;
        for (const days of [30, 7, 1]) {
          const date = new Date(expiry);
          date.setDate(date.getDate() - days);
          date.setHours(9, 0, 0, 0);
          if (date.getTime() > Date.now()) reminders.push({ title: `Warranty expires in ${days} ${days===1?'day':'days'}`, body: `${product.name} warranty expires on ${expiry.toLocaleDateString()}.`, date });
        }
      }
      const ids: string[] = [];
      for (const reminder of reminders.slice(0, 60)) ids.push(await Notifications.scheduleNotificationAsync({ content:{ title:reminder.title, body:reminder.body, data:{type:'warranty-expiry'} }, trigger:{ type:Notifications.SchedulableTriggerInputTypes.DATE, date:reminder.date } }));
      await SecureStore.setItemAsync('vault_local_reminder_ids',JSON.stringify(ids));
      Alert.alert('Reminders updated',ids.length ? `Scheduled ${ids.length} local reminders at 30, 7, or 1 day before warranty expiry.` : 'No future warranty expiries are recorded yet. Add warranty dates to products to schedule reminders.');
    } catch(e) { Alert.alert('Unable to set reminders',String(e)); }
  }
  async function openInvoice(id:string) {
    try {
      const response = await fetch(apiUrl() + '/invoices/' + id + '/download-link', { headers:{Authorization:'Bearer '+token} });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to open invoice');
      await Linking.openURL(data.url);
    } catch(e) { Alert.alert('Open invoice',String(e)); }
  }
  async function confirm() {
    if (draft.purchaseDate && !dateOnly(draft.purchaseDate)) { Alert.alert('Invalid date', 'Enter the purchase date as YYYY-MM-DD.'); return; }
    for (const item of draft.items as Item[]) {
      if ((item.warrantyStartDate && !dateOnly(item.warrantyStartDate)) || (item.warrantyEndDate && !dateOnly(item.warrantyEndDate))) {
        Alert.alert('Invalid date', 'Enter warranty dates as YYYY-MM-DD.'); return;
      }
      const months = String(item.warrantyMonths ?? '').trim();
      if (months && (!/^\d+$/.test(months) || !Number.isSafeInteger(Number(months)) || Number(months) < 1 || Number(months) > 1200)) {
        Alert.alert('Invalid duration', 'Enter a whole number of warranty months between 1 and 1200.'); return;
      }
    }
    setBusy(true);
    try {
      await request('/invoices/' + invoiceId + '/confirm', { method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(draft) });
      setDraft(null);setTab('products');await refresh();
      Alert.alert('Saved','Invoice and products saved.');
    } catch(e) { Alert.alert('Unable to save',String(e)); } finally { setBusy(false); }
  }
  const field = (label:string,value:string,onChange:(s:string)=>void) => <View style={{marginBottom:12}}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} value={value || ''} onChangeText={onChange} placeholder={label} autoCapitalize="none" /></View>;
  const button = (label:string,onPress:()=>void) => <TouchableOpacity disabled={busy} style={styles.button} onPress={onPress}><Text style={styles.buttonText}>{label}</Text></TouchableOpacity>;
  const authButton = (action:'login'|'register',label:string) => <TouchableOpacity disabled={busy} style={styles.button} onPress={()=>auth(action)}>{busy&&authAction===action?<View style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10}}><ActivityIndicator color="#fff"/><Text style={styles.buttonText}>{action==='login'?'Signing in securely…':'Creating your account…'}</Text></View>:<Text style={styles.buttonText}>{label}</Text>}</TouchableOpacity>;
  const googleButton = <TouchableOpacity disabled={busy} style={styles.googleButton} onPress={googleLogin}>{busy&&authAction==='google'?<View style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10}}><ActivityIndicator/><Text style={styles.googleButtonText}>Connecting to Google…</Text></View>:<Text style={styles.googleButtonText}>G  Continue with Google</Text>}</TouchableOpacity>;
  if (restoring) return <SafeAreaView style={styles.root}><Text style={styles.title}>Loading Invoice Vault…</Text></SafeAreaView>;
  if (!token) return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.body}><StatusBar style="dark"/><Text style={styles.title}>Invoice Vault</Text><Text style={styles.subtitle}>{authMode==='login'?'Sign in to access your purchases and warranties.':'Create an account to start your personal vault.'}</Text><Text style={{fontSize:20,fontWeight:'700',color:'#172033',marginTop:20,marginBottom:6}}>{authMode==='login'?'Welcome back':'Create your account'}</Text><Text style={styles.note}>{authMode==='login'?'Use your existing account to continue.':'New to Invoice Vault? Enter your email and choose a password.'}</Text>{field('Email',email,setEmail)}{field('Password (10+ characters)',password,setPassword)}{authButton(authMode,authMode==='login'?'Sign in':'Create account')}<TouchableOpacity disabled={busy} onPress={()=>setAuthMode(authMode==='login'?'register':'login')} style={{paddingVertical:16,alignItems:'center'}}><Text style={styles.link}>{authMode==='login'?"New here? Create an account":"Already have an account? Sign in"}</Text></TouchableOpacity><View style={styles.authDivider}><View style={styles.authDividerLine}/><Text style={styles.authDividerText}>OR</Text><View style={styles.authDividerLine}/></View>{googleButton}{!googleConfig.webClientId&&<Text style={styles.googleSetupNote}>Google sign-in requires OAuth client IDs to be configured.</Text>}</ScrollView></SafeAreaView>;
  return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.body}><StatusBar style={darkMode?'light':'dark'}/><Text style={styles.title}>Invoice Vault</Text><Text style={styles.subtitle}>{products.length} products · {expiring.length} warranties expiring within 30 days</Text>
    <View style={styles.tabs}>{['products','invoices','assistant','settings','review'].filter(x=>x!=='review'||draft).map(t=><TouchableOpacity key={t} onPress={()=>setTab(t)} style={[styles.tab,tab===t&&styles.selected]}><Text style={[styles.tabText,tab===t&&styles.selectedTabText]}>{t.toUpperCase()}</Text></TouchableOpacity>)}</View>
    {tab==='products' && <><View style={styles.vaultBanner}><View style={styles.vaultCopy}><Text style={styles.overline}>YOUR VAULT</Text><Text style={styles.vaultTitle}>Products & coverage</Text><Text style={styles.vaultSubtitle}>Keep your purchases and protection in one place.</Text></View><TouchableOpacity style={styles.refreshButton} onPress={refresh}><Text style={styles.refreshText}>↻</Text></TouchableOpacity></View><View style={styles.statsRow}><View style={styles.statCard}><Text style={styles.statValue}>{products.length}</Text><Text style={styles.statLabel}>Products</Text></View><View style={styles.statCard}><Text style={styles.statValue}>{products.reduce((count,p)=>count+(p.items||[]).filter((it:any)=>it.warranty?.expiresAt&&new Date(it.warranty.expiresAt).getTime()>=Date.now()).length,0)}</Text><Text style={styles.statLabel}>Under warranty</Text></View><View style={styles.statCard}><Text style={[styles.statValue,styles.attentionValue]}>{expiring.length}</Text><Text style={styles.statLabel}>Expiring soon</Text></View></View><View style={styles.actionRow}><TouchableOpacity disabled={busy} style={styles.uploadButton} onPress={upload}><Text style={styles.buttonText}>＋  Add invoice</Text></TouchableOpacity><TouchableOpacity style={styles.reminderButton} onPress={enableReminders}><Text style={styles.reminderText}>🔔  Set reminders</Text></TouchableOpacity></View>{!!uploadStatus && <View accessibilityRole="progressbar" accessibilityLabel={uploadStatus} style={styles.card}><ActivityIndicator size="large" /><Text style={styles.note}>{uploadStatus} Please wait.</Text></View>}<TextInput style={styles.searchInput} value={productSearch} onChangeText={setProductSearch} placeholder="Search products, brands, models" placeholderTextColor={darkMode?'#9aabc1':'#8290a5'} autoCapitalize="none" /><View style={styles.filterRow}>{([{id:'all',label:'All'},{id:'active',label:'Covered'},{id:'soon',label:'Expiring'},{id:'expired',label:'Expired'},{id:'none',label:'No warranty'}] as {id:ProductFilter;label:string}[]).map(option=><TouchableOpacity key={option.id} onPress={()=>setProductFilter(option.id)} style={[styles.filterChip,productFilter===option.id&&styles.filterChipSelected]}><Text style={[styles.filterChipText,productFilter===option.id&&styles.filterChipTextSelected]}>{option.label}</Text></TouchableOpacity>)}</View>{products.filter(p=>[p.name,p.brand,p.model].some(value=>normalizeDuplicateKey(value).includes(normalizeDuplicateKey(productSearch)))&&(productFilter==='all'||productWarrantyFilter(p)===productFilter)).length===0 ? <View style={styles.emptyState}><Text style={styles.emptyIcon}>{productSearch?'⌕':'▣'}</Text><Text style={styles.heading}>{productSearch?'No matching products':productFilter!=='all'?'No products in this category':'Your vault is ready'}</Text><Text style={styles.note}>{productSearch?'Try another product name, brand, or model.':productFilter!=='all'?'Try another warranty filter.':'Add an invoice to keep products and warranty dates together.'}</Text>{!productSearch&&productFilter==='all'&&<TouchableOpacity style={styles.uploadButton} onPress={upload}><Text style={styles.buttonText}>＋  Upload your first invoice</Text></TouchableOpacity>}</View> : products.filter(p=>[p.name,p.brand,p.model].some(value=>normalizeDuplicateKey(value).includes(normalizeDuplicateKey(productSearch)))&&(productFilter==='all'||productWarrantyFilter(p)===productFilter)).map(p=><View key={p.id} style={styles.productCard}><View style={styles.productTop}><View style={styles.productIcon}><Text style={styles.productIconText}>{(p.name||'?').trim().charAt(0).toUpperCase()}</Text></View><View style={styles.productTitleBlock}><Text style={styles.productName}>{p.name}</Text><Text style={styles.note}>{[p.brand,p.model].filter(Boolean).join(' · ')||'Brand or model not set'}</Text></View></View>{p.items.map((it:any)=>{const expiry=it.warranty?.expiresAt?new Date(it.warranty.expiresAt):null;const days=expiry?Math.ceil((expiry.getTime()-Date.now())/86400000):null;const label=days===null?'Warranty not recorded':days<0?'Warranty expired':days<=30?'Expires soon':'Under warranty';const tone=days===null?'neutral':days<0?'expired':days<=30?'soon':'active';return <View key={it.id} style={styles.warrantyRow}><View style={[styles.warrantyDot,{backgroundColor:tone==='active'?'#219653':tone==='soon'?'#e5a000':tone==='expired'?'#d34':'#8190a5'}]}/><View style={styles.warrantyTextBlock}><Text style={styles.warrantyLabel}>{label}</Text><Text style={styles.note}>{expiry?`Until ${expiry.toLocaleDateString()}`:'Add warranty details from invoice review'}</Text></View>{days!==null&&<Text style={[styles.daysLeft,days<=30&&styles.daysUrgent]}>{days<0?`${Math.abs(days)}d ago`:`${days}d`}</Text>}</View>})}<View style={styles.supportSection}><Text style={styles.supportHeading}>CUSTOMER CARE</Text>{p.support.map((s:any)=><View key={s.id} style={styles.contactCard}><Text style={styles.contactName}>{s.name}</Text>{s.phone&&<TouchableOpacity onPress={()=>Linking.openURL('tel:'+s.phone)}><Text style={styles.link}>☎  {s.phone}</Text></TouchableOpacity>}{s.email&&<TouchableOpacity onPress={()=>Linking.openURL('mailto:'+s.email)}><Text style={styles.link}>✉  {s.email}</Text></TouchableOpacity>}{s.website&&<TouchableOpacity onPress={()=>Linking.openURL(s.website)}><Text style={styles.link}>↗  {s.website}</Text></TouchableOpacity>}<Text style={styles.contactTrust}>{s.verifiedAt?'Verified contact':'Contact saved by you · verify before sharing'}</Text></View>)}{supportProductId===p.id ? <View style={styles.contactForm}><Text style={styles.contactFormTitle}>Add customer care</Text>{field('Manufacturer or service center',supportName,setSupportName)}{field('Phone',supportPhone,setSupportPhone)}{field('Email',supportEmail,setSupportEmail)}{field('Website',supportWebsite,setSupportWebsite)}{field('Source URL (optional)',supportSource,setSupportSource)}<TouchableOpacity disabled={supportSaving} style={styles.askButton} onPress={()=>saveSupportContact(p.id)}><Text style={styles.askButtonText}>{supportSaving?'Saving…':'Save contact'}</Text></TouchableOpacity><TouchableOpacity onPress={()=>setSupportProductId('')}><Text style={styles.link}>Cancel</Text></TouchableOpacity></View>:<TouchableOpacity onPress={()=>{setSupportProductId(p.id);setSupportName('');setSupportPhone('');setSupportEmail('');setSupportWebsite('');setSupportSource('')}}><Text style={styles.link}>＋ Add customer care details</Text></TouchableOpacity>}<TouchableOpacity style={styles.claimButton} onPress={()=>startWarrantyClaim(p)}><Text style={styles.claimButtonText}>Chat about a warranty claim  →</Text></TouchableOpacity></View></View>)}</>}
    {tab==='assistant' && <WarrantyAssistant apiUrl={apiUrl()} token={token} products={products} initialProductId={claimProductId} darkMode={darkMode}/>}{false && tab==='assistant' && <View style={styles.assistantScreen}><View style={styles.assistantHero}><Text style={styles.assistantEyebrow}>YOUR PERSONAL HELPER</Text><Text style={styles.assistantTitle}>Purchase assistant</Text><Text style={styles.assistantIntro}>Ask about products, invoice details, or warranty dates saved in your vault.</Text></View>{!!claimProductId&&<View style={styles.claimForm}><Text style={styles.claimTitle}>Warranty claim helper</Text><Text style={styles.note}>Answer a few questions and AI will prepare an editable claim message. It won’t submit the claim.</Text><Text style={styles.claimProduct}>{products.find(p=>p.id===claimProductId)?.name||'Selected product'}</Text><Text style={styles.askLabel}>WHAT IS WRONG WITH THE PRODUCT?</Text><TextInput style={styles.askInput} value={claimIssue} onChangeText={setClaimIssue} placeholder="Describe the issue and when it happens" placeholderTextColor={darkMode?'#9aabc1':'#8290a5'} multiline maxLength={2000} textAlignVertical="top"/><Text style={styles.askLabel}>WHEN DID YOU FIRST NOTICE IT? (OPTIONAL)</Text><TextInput style={styles.input} value={claimNoticedOn} onChangeText={setClaimNoticedOn} placeholder="YYYY-MM-DD" placeholderTextColor={darkMode?'#9aabc1':'#8290a5'} autoCapitalize="none"/><Text style={styles.askLabel}>WHAT HAVE YOU TRIED? (OPTIONAL)</Text><TextInput style={styles.askInput} value={claimSteps} onChangeText={setClaimSteps} placeholder="Any troubleshooting or service already attempted" placeholderTextColor={darkMode?'#9aabc1':'#8290a5'} multiline maxLength={1000} textAlignVertical="top"/><TouchableOpacity disabled={claimLoading} style={styles.askButton} onPress={generateClaimDraft}>{claimLoading?<><ActivityIndicator color="white"/><Text style={styles.askButtonText}>Preparing your draft…</Text></>:<Text style={styles.askButtonText}>✦  Prepare claim draft</Text>}</TouchableOpacity>{!!claimError&&<Text accessibilityRole="alert" style={styles.assistantErrorText}>{claimError}</Text>}{!!claimDraft&&<><Text style={styles.askLabel}>EDIT AND VERIFY BEFORE SENDING</Text><TextInput style={styles.claimDraftInput} value={claimDraft} onChangeText={setClaimDraft} multiline textAlignVertical="top"/><TouchableOpacity style={styles.shareButton} onPress={shareClaimDraft}><Text style={styles.shareText}>↗  Share claim draft</Text></TouchableOpacity></>}<TouchableOpacity onPress={()=>{setClaimProductId('');setClaimDraft('')}}><Text style={styles.link}>Close claim helper</Text></TouchableOpacity></View>}<Text style={styles.promptLabel}>TRY ASKING</Text><View style={styles.promptList}>{['When does my next warranty expire?','Show my recent purchases','Which products are still under warranty?'].map(prompt=><TouchableOpacity key={prompt} disabled={assistantLoading} style={styles.promptChip} onPress={()=>{setQuestion(prompt);askAssistant(prompt)}}><Text style={styles.promptText}>{prompt}  ›</Text></TouchableOpacity>)}</View><View style={styles.askBox}><Text style={styles.askLabel}>YOUR QUESTION</Text><TextInput style={styles.askInput} value={question} onChangeText={value=>{setQuestion(value);setAssistantError('')}} placeholder="e.g. Is my mixer still under warranty?" placeholderTextColor={darkMode?'#9aabc1':'#8290a5'} multiline maxLength={1000} textAlignVertical="top" returnKeyType="send" onSubmitEditing={()=>askAssistant()} editable={!assistantLoading} /><TouchableOpacity accessibilityRole="button" disabled={assistantLoading||!question.trim()} style={[styles.askButton,(assistantLoading||!question.trim())&&styles.askButtonDisabled]} onPress={()=>askAssistant()}>{assistantLoading?<><ActivityIndicator color="white"/><Text style={styles.askButtonText}>Checking your vault…</Text></>:<Text style={styles.askButtonText}>Ask assistant  →</Text>}</TouchableOpacity></View>{!!assistantError&&<View accessibilityRole="alert" style={styles.assistantError}><Text style={styles.assistantErrorTitle}>Couldn’t get an answer</Text><Text style={styles.assistantErrorText}>{assistantError}</Text><TouchableOpacity onPress={()=>askAssistant()}><Text style={styles.retryText}>Try again</Text></TouchableOpacity></View>}{!!answer&&<View style={styles.answerCard}><View style={styles.answerHeader}><View style={styles.answerIcon}><Text style={styles.answerIconText}>✦</Text></View><View><Text style={styles.answerTitle}>Answer</Text><Text style={styles.answerSource}>Based on details in your vault</Text></View></View><Text selectable style={styles.answerText}>{answer}</Text></View>}<Text style={styles.assistantDisclaimer}>Answers are generated from your saved records and may not reflect your manufacturer’s latest warranty terms.</Text></View>}
    {tab==='settings' && <View style={styles.card}><Text style={styles.heading}>Appearance</Text><Text style={styles.note}>Choose how Invoice Vault looks on this device.</Text><View style={styles.themeChoices}>{(['light','dark'] as const).map(mode=><TouchableOpacity key={mode} accessibilityRole="button" accessibilityState={{selected:theme===mode}} onPress={async()=>{setTheme(mode);await SecureStore.setItemAsync('vault_theme',mode)}} style={[styles.themeOption,theme===mode&&styles.themeSelected]}><Text style={[styles.themeOptionTitle,theme===mode&&styles.themeSelectedText]}>{mode==='light'?'☀️  Light':'🌙  Dark'}</Text><Text style={[styles.themeOptionNote,theme===mode&&styles.themeSelectedText]}>{mode==='light'?'Bright background':'Low-light friendly'}</Text></TouchableOpacity>)}</View></View>}
    {tab==='invoices' && <><View style={styles.sectionHeader}><Text style={styles.heading}>Your invoices</Text><Text style={styles.note}>{invoices.length} saved</Text></View>{invoices.map(i=><View key={i.id} style={styles.invoiceCard}><View style={styles.invoiceTop}><View style={styles.invoiceTitleBlock}><Text style={styles.heading}>{i.seller || 'Invoice'}</Text><Text style={styles.invoiceNumber}>{i.invoiceNumber ? `#${i.invoiceNumber}` : 'Invoice number not set'}</Text></View><View style={styles.statusPill}><Text style={styles.statusText}>{i.status==='CONFIRMED'?'SAVED':'REVIEW'}</Text></View></View><View style={styles.invoiceMeta}><Text style={styles.note}>{i.purchaseDate ? new Date(i.purchaseDate).toLocaleDateString() : 'Date not set'}</Text><Text style={styles.note}>{i.items.length} {i.items.length===1?'item':'items'}{i.total!=null?` · ${i.currency||'INR'} ${i.total}`:''}</Text></View>{i.items.length>0 && <Text style={styles.invoiceProducts} numberOfLines={2}>{i.items.map((line:any)=>line.product?.name).filter(Boolean).join(' · ')}</Text>}<View style={styles.invoiceActions}><TouchableOpacity style={styles.shareButton} onPress={()=>shareInvoice(i)} disabled={!!sharingInvoiceId}><Text style={styles.shareText}>{sharingInvoiceId===i.id?'Preparing file…':`↗  Share ${i.mimeType==='application/pdf'?'invoice PDF':'invoice file'}`}</Text></TouchableOpacity><TouchableOpacity onPress={()=>openInvoice(i.id)}><Text style={styles.link}>View invoice</Text></TouchableOpacity><TouchableOpacity style={styles.deleteButton} onPress={()=>deleteInvoice(i)}><Text style={styles.deleteText}>Delete</Text></TouchableOpacity></View></View>)}</>}
    {tab==='review' && draft && <><Text style={styles.heading}>Review invoice details</Text><View style={styles.infoCard}><Text style={styles.heading}>Duplicate checks</Text><Text style={styles.note}>Invoice number + seller is the strongest invoice check. Product-name matches are warnings only—identical products can be purchased more than once.</Text></View>{draft.invoiceNumber && invoices.some((existing:any)=>existing.id!==invoiceId && existing.status==='CONFIRMED' && normalizeDuplicateKey(existing.invoiceNumber)===normalizeDuplicateKey(draft.invoiceNumber) && normalizeDuplicateKey(existing.seller)===normalizeDuplicateKey(draft.seller)) && <View style={styles.warningCard}><Text style={styles.warningTitle}>Possible duplicate invoice</Text><Text style={styles.note}>An invoice with this number and seller is already saved. Check the Invoices tab before continuing.</Text></View>}{field('Invoice number',draft.invoiceNumber,(v)=>setDraft({...draft,invoiceNumber:v}))}{field('Seller',draft.seller,(v)=>setDraft({...draft,seller:v}))}{field('Purchase date (YYYY-MM-DD)',draft.purchaseDate,(v)=>setDraft({...draft,purchaseDate:v}))}{draft.items.map((it:Item,index:number)=><View key={index} style={styles.card}><View style={styles.productHeader}><Text style={styles.heading}>Product {index+1}</Text>{draft.items.length>1&&<TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove product ${index+1}`} hitSlop={10} onPress={()=>removeItem(index)} style={styles.removeProductButton}><Text style={styles.removeProductText}>🗑 Remove</Text></TouchableOpacity>}</View>{field('Product name',it.name,(v)=>changeItem(index,'name',v))}{it.name && products.some((existing:any)=>normalizeDuplicateKey(existing.name)===normalizeDuplicateKey(it.name)) && <Text style={styles.warningText}>A product with this name is already in your vault. Check its model or serial number; this may still be a separate purchase.</Text>}{field('Brand',it.brand||'',(v)=>changeItem(index,'brand',v))}{field('Warranty duration (months)',String(it.warrantyMonths ?? ''),(v)=>changeItem(index,'warrantyMonths',v))}{field('Warranty start date (YYYY-MM-DD)',it.warrantyStartDate||'',(v)=>changeItem(index,'warrantyStartDate',v))}{field('Warranty expiry (YYYY-MM-DD)',it.warrantyEndDate||'',(v)=>changeItem(index,'warrantyEndDate',v))}<Text style={styles.note}>{warrantyPreview(it, draft.purchaseDate)}</Text></View>)}{button('Add another product',()=>setDraft({...draft,items:[...draft.items,{name:''}]}))}{button('Confirm and save',confirm)}</>}
    <TouchableOpacity onPress={async()=>{await SecureStore.deleteItemAsync('vault_token');setToken('');setProducts([]);setInvoices([]);}}><Text style={styles.link}>Sign out</Text></TouchableOpacity>
  </ScrollView></SafeAreaView>;
  function removeItem(index:number) { setDraft((previous:any)=>({...previous,items:previous.items.filter((_:Item,i:number)=>i!==index)})); }
  function changeItem(index:number,key:string,value:string) { setDraft((previous:any)=>({...previous,items:previous.items.map((item:any,i:number)=>i===index?{...item,[key]:value}:item)})); }
}
function createStyles(dark:boolean) {
  const bg = dark ? '#101827' : '#f5f7fb';
  const surface = dark ? '#1b2738' : '#ffffff';
  const text = dark ? '#f2f5fb' : '#17243c';
  const muted = dark ? '#a9b7cb' : '#627087';
  const border = dark ? '#34445a' : '#dce3ee';
  return StyleSheet.create({
    root:{flex:1,backgroundColor:bg},body:{padding:24,gap:16},title:{fontSize:30,fontWeight:'800' as const,color:text,marginTop:24},
    subtitle:{fontSize:15,color:muted,lineHeight:22},label:{fontSize:13,color:muted,marginBottom:5},
    input:{backgroundColor:surface,borderColor:border,borderWidth:1,padding:12,borderRadius:10,color:text},
    button:{backgroundColor:'#2659d9',padding:16,borderRadius:14,alignItems:'center' as const},
    buttonText:{color:'white',fontWeight:'700' as const,fontSize:15},googleButton:{backgroundColor:dark?'#1b2738':'#fff',padding:15,borderRadius:14,alignItems:'center' as const,borderWidth:1,borderColor:border},googleButtonText:{color:text,fontWeight:'700' as const,fontSize:15},authDivider:{flexDirection:'row' as const,alignItems:'center' as const,gap:10,marginVertical:3},authDividerLine:{flex:1,height:1,backgroundColor:border},authDividerText:{fontSize:11,fontWeight:'700' as const,color:muted},googleSetupNote:{fontSize:12,textAlign:'center' as const,color:muted},heading:{fontSize:18,fontWeight:'700' as const,color:text},
    card:{backgroundColor:surface,padding:16,borderRadius:14,gap:8},removeProductButton:{paddingVertical:5,paddingHorizontal:9,borderRadius:9,backgroundColor:dark?'#482b31':'#fff0f0'},removeProductText:{fontSize:12,fontWeight:'700' as const,color:dark?'#ff9c9c':'#b42318'},invoiceCard:{backgroundColor:surface,padding:18,borderRadius:18,gap:12,borderWidth:1,borderColor:border,shadowColor:'#000',shadowOpacity:dark?0:0.06,shadowRadius:10,elevation:2},
    infoCard:{backgroundColor:dark?'#1b3150':'#eaf1ff',padding:16,borderRadius:14,gap:8,borderLeftWidth:4,borderLeftColor:'#5681ed'},warningCard:{backgroundColor:dark?'#3c2e1a':'#fff4df',padding:16,borderRadius:14,gap:8,borderLeftWidth:4,borderLeftColor:'#d88700'},warningTitle:{fontSize:16,fontWeight:'700' as const,color:dark?'#ffd181':'#805000'},warningText:{color:dark?'#ffd181':'#805000',marginBottom:10},note:{color:muted},link:{color:dark?'#93b4ff':'#2659d9',marginTop:8},
    tabs:{flexDirection:'row' as const,gap:8,flexWrap:'wrap' as const},tab:{padding:10,borderRadius:10,backgroundColor:dark?'#26364d':'#e6eaf1'},selected:{backgroundColor:'#2659d9'},tabText:{color:text,fontWeight:'600' as const},selectedTabText:{color:'white'},
    vaultBanner:{flexDirection:'row' as const,alignItems:'center' as const,justifyContent:'space-between' as const,padding:20,borderRadius:22,backgroundColor:dark?'#1d3554':'#dfeaff',borderWidth:1,borderColor:dark?'#355276':'#ccdcf6'},vaultCopy:{flex:1,gap:5},overline:{fontSize:10,fontWeight:'800' as const,letterSpacing:1.5,color:dark?'#a9c6f5':'#4468a6'},vaultTitle:{fontSize:24,fontWeight:'800' as const,color:text},vaultSubtitle:{fontSize:13,color:muted,lineHeight:18},statsRow:{flexDirection:'row' as const,gap:9},statCard:{flex:1,backgroundColor:surface,borderWidth:1,borderColor:border,borderRadius:15,padding:13,gap:4},statValue:{fontSize:22,fontWeight:'800' as const,color:text},statLabel:{fontSize:11,color:muted},attentionValue:{color:dark?'#ffbd69':'#ae6900'},shareButton:{paddingHorizontal:11,paddingVertical:8,borderRadius:9,backgroundColor:dark?'#233c5e':'#eaf1ff'},shareText:{color:dark?'#bcd2ff':'#2659d9',fontWeight:'700' as const,fontSize:12},filterRow:{flexDirection:'row' as const,flexWrap:'wrap' as const,gap:8,marginBottom:2},filterChip:{paddingHorizontal:13,paddingVertical:9,borderRadius:20,backgroundColor:dark?'#223148':'#edf2fa',borderWidth:1,borderColor:dark?'#31445f':'#e3e9f2'},filterChipSelected:{backgroundColor:dark?'#284775':'#e3edff',borderColor:dark?'#6087bf':'#b7cbf3'},filterChipText:{fontSize:12,fontWeight:'600' as const,color:muted},filterChipTextSelected:{color:dark?'#d7e4ff':'#214ba9'},productHeader:{flexDirection:'row' as const,justifyContent:'space-between' as const,alignItems:'center' as const},actionRow:{flexDirection:'row' as const,gap:10},uploadButton:{flex:1,backgroundColor:'#2659d9',padding:15,borderRadius:14,alignItems:'center' as const,justifyContent:'center' as const},reminderButton:{padding:14,borderRadius:14,backgroundColor:dark?'#273950':'#e8eef9',justifyContent:'center' as const},reminderText:{color:text,fontWeight:'600' as const},refreshButton:{width:44,height:44,borderRadius:14,alignItems:'center' as const,justifyContent:'center' as const,backgroundColor:dark?'#273950':'#e8eef9'},refreshText:{fontSize:28,color:dark?'#d7e4ff':'#2659d9'},searchInput:{backgroundColor:surface,borderWidth:1,borderColor:border,borderRadius:14,paddingHorizontal:16,paddingVertical:13,color:text},emptyState:{alignItems:'center' as const,backgroundColor:surface,borderRadius:20,padding:28,gap:12},emptyIcon:{fontSize:42,color:dark?'#91a7c7':'#8194b1'},productCard:{backgroundColor:surface,padding:18,borderRadius:18,gap:14,borderWidth:1,borderColor:border,shadowColor:'#000',shadowOpacity:dark?0:0.06,shadowRadius:10,elevation:2},productTop:{flexDirection:'row' as const,alignItems:'center' as const,gap:13},productIcon:{width:48,height:48,borderRadius:15,backgroundColor:dark?'#283e60':'#eaf1ff',alignItems:'center' as const,justifyContent:'center' as const},productIconText:{fontSize:21,fontWeight:'800' as const,color:dark?'#b8ceff':'#2659d9'},productTitleBlock:{flex:1,gap:4},productName:{fontSize:17,fontWeight:'700' as const,color:text},warrantyRow:{flexDirection:'row' as const,alignItems:'center' as const,gap:10,padding:12,borderRadius:13,backgroundColor:dark?'#202e42':'#f6f8fc'},warrantyDot:{width:9,height:9,borderRadius:5},warrantyTextBlock:{flex:1,gap:3},warrantyLabel:{fontWeight:'700' as const,color:text,fontSize:13},daysLeft:{fontSize:12,color:muted,fontWeight:'600' as const},daysUrgent:{color:dark?'#ffbc72':'#aa6500'},supportSection:{borderTopWidth:1,borderTopColor:border,paddingTop:10,gap:9},supportHeading:{fontSize:10,letterSpacing:1,fontWeight:'700' as const,color:muted},contactCard:{backgroundColor:dark?'#202e42':'#f6f8fc',padding:12,borderRadius:12,gap:3},contactName:{fontSize:14,fontWeight:'700' as const,color:text},contactTrust:{fontSize:11,color:muted,marginTop:3},contactForm:{padding:14,borderRadius:14,backgroundColor:dark?'#202e42':'#f6f8fc',gap:7},contactFormTitle:{fontWeight:'700' as const,color:text,fontSize:15},claimButton:{padding:13,borderRadius:12,backgroundColor:dark?'#273950':'#e8eef9',alignItems:'center' as const},claimButtonText:{fontWeight:'700' as const,color:dark?'#bcd2ff':'#2659d9'},claimForm:{padding:17,borderRadius:18,backgroundColor:surface,borderWidth:1,borderColor:border,gap:10},claimTitle:{fontSize:19,fontWeight:'800' as const,color:text},claimProduct:{fontSize:15,fontWeight:'700' as const,color:dark?'#bcd2ff':'#2659d9'},claimDraftInput:{minHeight:190,maxHeight:360,color:text,fontSize:14,lineHeight:21,padding:13,borderRadius:12,backgroundColor:dark?'#121d2b':'#f5f7fb'},
    assistantScreen:{gap:14},assistantHero:{padding:22,borderRadius:22,backgroundColor:dark?'#1d3554':'#dfeaff',gap:7},assistantEyebrow:{fontSize:10,fontWeight:'800' as const,letterSpacing:1.5,color:dark?'#a9c6f5':'#4468a6'},assistantTitle:{fontSize:25,fontWeight:'800' as const,color:text},assistantIntro:{fontSize:14,lineHeight:20,color:muted},promptLabel:{fontSize:11,fontWeight:'800' as const,letterSpacing:1.1,color:muted,marginTop:4},promptList:{gap:8},promptChip:{alignSelf:'flex-start' as const,maxWidth:'100%' as const,paddingHorizontal:13,paddingVertical:10,borderRadius:20,backgroundColor:dark?'#26364d':'#edf2fa'},promptText:{fontSize:13,color:text},askBox:{padding:16,borderRadius:18,backgroundColor:surface,borderWidth:1,borderColor:border,gap:10},askLabel:{fontSize:11,fontWeight:'800' as const,letterSpacing:1,color:muted},askInput:{minHeight:92,maxHeight:170,color:text,fontSize:15,lineHeight:22,padding:12,borderRadius:12,backgroundColor:dark?'#121d2b':'#f5f7fb'},askButton:{minHeight:48,flexDirection:'row' as const,alignItems:'center' as const,justifyContent:'center' as const,gap:9,padding:12,borderRadius:13,backgroundColor:'#2659d9'},askButtonDisabled:{opacity:0.55},askButtonText:{color:'white',fontWeight:'700' as const,fontSize:15},answerCard:{padding:18,borderRadius:18,backgroundColor:surface,borderWidth:1,borderColor:border,gap:14},answerHeader:{flexDirection:'row' as const,alignItems:'center' as const,gap:11},answerIcon:{width:36,height:36,borderRadius:12,alignItems:'center' as const,justifyContent:'center' as const,backgroundColor:dark?'#283e60':'#eaf1ff'},answerIconText:{fontSize:20,color:dark?'#b8ceff':'#2659d9'},answerTitle:{fontWeight:'800' as const,fontSize:16,color:text},answerSource:{fontSize:11,color:muted,marginTop:2},answerText:{fontSize:15,lineHeight:23,color:text},assistantError:{padding:15,borderRadius:15,backgroundColor:dark?'#482a32':'#fff0f0',gap:6},assistantErrorTitle:{fontWeight:'700' as const,color:dark?'#ff9aa7':'#b42332'},assistantErrorText:{color:dark?'#ffd1d6':'#6f2931',lineHeight:20},retryText:{marginTop:4,fontWeight:'700' as const,color:dark?'#ffb1ba':'#b42332'},assistantDisclaimer:{fontSize:11,lineHeight:16,color:muted,marginTop:4},
    sectionHeader:{flexDirection:'row' as const,justifyContent:'space-between' as const,alignItems:'center' as const},invoiceTop:{flexDirection:'row' as const,justifyContent:'space-between' as const,alignItems:'flex-start' as const},invoiceTitleBlock:{flex:1,gap:4},invoiceNumber:{color:muted,fontSize:14},statusPill:{backgroundColor:dark?'#244739':'#e3f6ec',paddingHorizontal:10,paddingVertical:5,borderRadius:20},statusText:{fontSize:11,fontWeight:'700' as const,color:dark?'#8ee0b4':'#237448'},invoiceMeta:{flexDirection:'row' as const,justifyContent:'space-between' as const},invoiceProducts:{color:text,fontSize:13},invoiceActions:{flexDirection:'row' as const,justifyContent:'space-between' as const,alignItems:'center' as const,flexWrap:'wrap' as const,gap:8,borderTopWidth:1,borderTopColor:border,paddingTop:10},deleteButton:{paddingHorizontal:13,paddingVertical:8,borderRadius:9,backgroundColor:dark?'#482a32':'#fff0f0'},deleteText:{color:dark?'#ff9aa7':'#b42332',fontWeight:'700' as const},themeChoices:{flexDirection:'row' as const,gap:12,marginTop:8},themeOption:{flex:1,padding:16,borderRadius:14,borderWidth:1,borderColor:border,backgroundColor:dark?'#222f43':'#f8faff',gap:8},themeSelected:{borderColor:'#5681ed',backgroundColor:dark?'#20375a':'#eaf1ff'},themeOptionTitle:{fontSize:16,fontWeight:'700' as const,color:text},themeOptionNote:{fontSize:12,color:muted},themeSelectedText:{color:dark?'#d7e4ff':'#214ba9'}
  });
}
