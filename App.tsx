import 'react-native-get-random-values'; 
import React, { useState, useEffect, useRef } from 'react';
import { 
  SafeAreaView, View, TextInput, TouchableOpacity, FlatList, 
  Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert, StatusBar, Image, PermissionsAndroid
} from 'react-native';
import io from 'socket.io-client';
import CryptoJS from 'crypto-js';
import { launchImageLibrary } from 'react-native-image-picker';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import RNFS from 'react-native-fs';

// IMPORTANT: Ensure this matches your live Render URL
const SERVER_URL = 'http://10.0.2.2:3000'; 
const socket = io(SERVER_URL);
const ROOM_SECRET = "super-secret-resume-project-key"; 

const audioRecorderPlayer = new AudioRecorderPlayer();

// PREMIUM UI COLOR PALETTE
const COLORS = { 
  bgMain: '#0F172A',      // Slate 900 (Deep modern background)
  bgCard: '#1E293B',      // Slate 800 (Elevated elements)
  bgInput: '#334155',     // Slate 700 (Inputs)
  primary: '#6366F1',     // Indigo 500 (Trustworthy brand color)
  primaryHover: '#4F46E5',// Indigo 600 (Sent messages)
  textMain: '#F8FAFC',    // Slate 50 (Bright crisp text)
  textMuted: '#94A3B8',   // Slate 400 (Secondary text)
  bubbleOther: '#334155', // Slate 700 (Received messages)
};

const EXPIRATION_MODES = {
  'off': { label: 'Standard', time: null, icon: '🛡️', color: COLORS.primary, bg: COLORS.bgMain, card: COLORS.bgCard, bubbleMe: COLORS.primaryHover, bubbleOther: COLORS.bubbleOther },
  'disp_10m': { label: 'Disappear (10m)', time: 10 * 60 * 1000, icon: '⏳', color: '#38BDF8', bg: '#082F49', card: '#0C4A6E', bubbleMe: '#0284C7', bubbleOther: '#0F172A' },
  'burn_10s': { label: 'Burn (10s)', time: 10000, icon: '🔥', color: '#F87171', bg: '#450A0A', card: '#7F1D1D', bubbleMe: '#DC2626', bubbleOther: '#280505' },
};

// --- DYNAMIC AUDIO COMPONENT ---
const SecureAudioBubble = ({ mediaId, modeData }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [audioPath, setAudioPath] = useState(null);

  useEffect(() => {
    fetch(`${SERVER_URL}/media/${mediaId}`)
      .then(res => res.json())
      .then(async data => {
        if (data.payload) {
          try {
            // Decrypt the Base64 audio string
            const bytes = CryptoJS.AES.decrypt(data.payload, ROOM_SECRET);
            const decryptedBase64 = bytes.toString(CryptoJS.enc.Utf8);
            
            if(decryptedBase64) {
              // Write it to a temporary hidden file so the native player can read it
              const path = `${RNFS.CachesDirectoryPath}/voice_${mediaId}.mp4`;
              await RNFS.writeFile(path, decryptedBase64, 'base64');
              setAudioPath(path);
            }
          } catch(e) { console.log("Audio Decryption Failed"); }
        }
        setLoading(false);
      }).catch(() => setLoading(false));
  }, [mediaId]);

  const togglePlay = async () => {
    if (!audioPath) return;
    if (isPlaying) {
      await audioRecorderPlayer.stopPlayer();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      await audioRecorderPlayer.startPlayer(audioPath);
      audioRecorderPlayer.addPlayBackListener((e) => {
        if (e.currentPosition === e.duration) {
          audioRecorderPlayer.stopPlayer();
          setIsPlaying(false);
        }
      });
    }
  };

  if (loading) return <Text style={{ color: modeData.color, fontStyle: 'italic', padding: 10 }}>Decrypting audio...</Text>;
  if (!audioPath) return <Text style={{ color: '#F87171', padding: 10 }}>Audio burned</Text>;

  return (
    <TouchableOpacity onPress={togglePlay} style={{ flexDirection: 'row', alignItems: 'center', padding: 8, width: 160 }}>
      <View style={styles.playButtonWrapper}>
        <Text style={{ fontSize: 18 }}>{isPlaying ? '⏸️' : '▶️'}</Text>
      </View>
      <Text style={{ color: '#FFF', marginLeft: 10, fontWeight: '600' }}>Voice Note</Text>
    </TouchableOpacity>
  );
};

// --- SECURE MEDIA COMPONENT ---
const SecureMediaBubble = ({ mediaId, modeData }) => {
  const [imgUri, setImgUri] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${SERVER_URL}/media/${mediaId}`)
      .then(res => res.json())
      .then(data => {
        if (data.payload) {
          try {
            const bytes = CryptoJS.AES.decrypt(data.payload, ROOM_SECRET);
            const decryptedBase64 = bytes.toString(CryptoJS.enc.Utf8);
            if(decryptedBase64) setImgUri(`data:image/jpeg;base64,${decryptedBase64}`);
          } catch(e) {}
        }
        setLoading(false);
      }).catch(() => setLoading(false));
  }, [mediaId]);

  if (loading) return <Text style={{ color: modeData.color || '#FFF', fontStyle: 'italic', padding: 10 }}>Decrypting image...</Text>;
  if (!imgUri) return <Text style={{ color: '#F87171', padding: 10 }}>Media burned</Text>;

  return <Image source={{ uri: imgUri }} style={{ width: 220, height: 280, borderRadius: 12, margin: 4 }} resizeMode="cover" />;
};


export default function App() {
  const [currentScreen, setCurrentScreen] = useState('auth'); 
  const [currentUser, setCurrentUser] = useState('');
  const [userBio, setUserBio] = useState('Secure connection established.');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(true);

  const [friends, setFriends] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeChatUser, setActiveChatUser] = useState(''); 

  const [message, setMessage] = useState('');
  const [chat, setChat] = useState([]);
  const [activeMode, setActiveMode] = useState('off');
  const [showModeMenu, setShowModeMenu] = useState(false);
  
  // Audio State
  const [isRecording, setIsRecording] = useState(false);

  const currentTheme = EXPIRATION_MODES[activeMode] || EXPIRATION_MODES['off'];

  // --- AUDIO RECORDING ENGINE ---
  const requestMicPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          { title: 'Microphone Permission', message: 'CipherRoom needs access to your microphone to send voice notes.', buttonNeutral: 'Ask Me Later', buttonNegative: 'Cancel', buttonPositive: 'OK', }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) { return false; }
    }
    return true;
  };

  const startRecording = async () => {
    const hasPermission = await requestMicPermission();
    if (!hasPermission) return Alert.alert("Permission Denied", "Cannot record audio.");
    
    setIsRecording(true);
    const path = Platform.OS === 'android' ? `${RNFS.CachesDirectoryPath}/temp_record.mp4` : 'temp_record.m4a';
    await audioRecorderPlayer.startRecorder(path);
  };

  const stopRecordingAndSend = async () => {
    if (!isRecording) return;
    setIsRecording(false);
    
    try {
      const resultURI = await audioRecorderPlayer.stopRecorder();
      const base64Audio = await RNFS.readFile(resultURI, 'base64');
      
      const mediaId = `audio_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const encryptedAudio = CryptoJS.AES.encrypt(base64Audio, ROOM_SECRET).toString();

      const response = await fetch(`${SERVER_URL}/upload-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: mediaId, payload: encryptedAudio })
      });

      if(response.ok) {
        const lifespan = EXPIRATION_MODES[activeMode].time;
        const messageData = { 
          id: Date.now().toString(), 
          encryptedPayload: CryptoJS.AES.encrypt("🎙️ Secure Voice Note", ROOM_SECRET).toString(), 
          senderId: currentUser,
          receiverId: activeChatUser.username, 
          expiresAt: lifespan ? Date.now() + lifespan : null, 
          mode: activeMode,
          mediaId: mediaId,
          type: 'audio', // New flag to distinguish media
          status: 'sent'
        };
        
        socket.emit('send_private_message', messageData);
        setChat((prev) => [...prev, { ...messageData, text: "🎙️ Secure Voice Note" }]);
      }
    } catch (e) { Alert.alert("Error", "Failed to encrypt and send voice note."); }
  };


  // --- AUTH & NETWORK SYNC ---
  const handleAuth = async () => {
    if (!authUsername || !authPassword) return Alert.alert("Error", "Please fill in all fields.");
    const endpoint = isLoginMode ? 'login' : 'register';
    try {
      const response = await fetch(`${SERVER_URL}/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername.toLowerCase(), password: authPassword })
      });
      const data = await response.json();
      if (data.success) {
        if (isLoginMode) {
          setCurrentUser(data.username);
          setUserBio(data.bio || 'Secure connection established.');
          socket.emit('register_user', data.username);
          fetchFriends(data.username);
          setCurrentScreen('home');
        } else {
          Alert.alert("Success", "Account created.");
          setIsLoginMode(true);
        }
      } else Alert.alert("Failed", data.error);
    } catch (error) { Alert.alert("Error", "Server offline."); }
  };

  const fetchFriends = async (username) => {
    try {
      const response = await fetch(`${SERVER_URL}/friends/${username}`);
      const data = await response.json();
      setFriends(data.accepted);
      setPendingRequests(data.pending);
    } catch (error) {}
  };

  useEffect(() => {
    socket.on('refresh_friends', () => { if(currentUser) fetchFriends(currentUser); });
    return () => socket.off('refresh_friends');
  }, [currentUser]);

  const sendFriendRequest = async () => {
    if (!searchQuery) return;
    try {
      const response = await fetch(`${SERVER_URL}/send-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: currentUser, receiver: searchQuery.toLowerCase() })
      });
      const data = await response.json();
      if (data.success) {
        setSearchQuery('');
        socket.emit('trigger_network_sync', searchQuery.toLowerCase()); 
      }
    } catch (error) { console.log(error); }
  };

  const acceptRequest = async (senderName) => {
    try {
      const response = await fetch(`${SERVER_URL}/accept-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: senderName, receiver: currentUser })
      });
      const data = await response.json();
      if (data.success) {
        fetchFriends(currentUser);
        socket.emit('trigger_network_sync', senderName); 
      }
    } catch (error) {}
  };

  // --- PERSISTENT HISTORY FETCHER ---
  const loadChatHistory = async (friendUsername) => {
    if (!currentUser || !friendUsername) return;
    try {
      const response = await fetch(`${SERVER_URL}/chat-history/${currentUser}/${friendUsername}`);
      const data = await response.json();
      
      const decryptedHistory = data.history.map(msg => {
        let decryptedText = "Decryption failed";
        try {
          const bytes = CryptoJS.AES.decrypt(msg.encrypted_payload, ROOM_SECRET);
          decryptedText = bytes.toString(CryptoJS.enc.Utf8);
        } catch (e) {}
        
        if (msg.receiver === currentUser && msg.status !== 'read') {
            socket.emit('mark_read', { id: msg.id, originalSender: msg.sender });
            msg.status = 'read';
        }

        // We infer type based on the ID prefix we set during upload
        const isAudio = msg.media_id && msg.media_id.startsWith('audio_');

        return {
          id: msg.id, senderId: msg.sender, receiverId: msg.receiver,
          text: decryptedText, expiresAt: msg.expires_at, mode: msg.mode, 
          mediaId: msg.media_id, type: isAudio ? 'audio' : (msg.media_id ? 'image' : 'text'), status: msg.status
        };
      });
      setChat(decryptedHistory);
    } catch (error) { console.log("Failed to load history"); }
  };

  const openChat = (friend) => {
    setActiveChatUser(friend);
    loadChatHistory(friend.username);
    setCurrentScreen('chat');
  };

  // --- SOCKET CHAT LOGIC ---
  useEffect(() => {
    const handleReceive = (data) => {
      if (data.senderId === currentUser) return; 
      try {
        const bytes = CryptoJS.AES.decrypt(data.encryptedPayload, ROOM_SECRET);
        const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
        if (decryptedText) {
          
          let updatedStatus = data.status;
          if (activeChatUser && data.senderId === activeChatUser.username) {
             socket.emit('mark_read', { id: data.id, originalSender: data.senderId });
             updatedStatus = 'read';
             setActiveMode(data.mode);
          }

          setChat((prev) => [...prev, {
            id: data.id, senderId: data.senderId, receiverId: data.receiverId,
            text: decryptedText, expiresAt: data.expiresAt, mode: data.mode, 
            mediaId: data.mediaId, type: data.type, status: updatedStatus
          }]);
        }
      } catch (error) {}
    };

    const handleReceiptUpdate = ({ id, status }) => {
      setChat((prev) => prev.map(msg => msg.id === id ? { ...msg, status } : msg));
    };

    socket.on('receive_message', handleReceive);
    socket.on('receipt_update', handleReceiptUpdate);
    return () => { socket.off('receive_message', handleReceive); socket.off('receipt_update', handleReceiptUpdate); };
  }, [currentUser, activeChatUser]); 

  const sendMessage = () => {
    if (message.trim()) {
      const scrambledText = CryptoJS.AES.encrypt(message, ROOM_SECRET).toString();
      const lifespan = EXPIRATION_MODES[activeMode].time;
      const messageId = Date.now().toString();

      const messageData = { 
        id: messageId, encryptedPayload: scrambledText, senderId: currentUser, receiverId: activeChatUser.username, 
        expiresAt: lifespan ? Date.now() + lifespan : null, mode: activeMode, mediaId: null, type: 'text', status: 'sent' 
      };
      
      socket.emit('send_private_message', messageData);
      setChat((prev) => [...prev, { ...messageData, text: message }]);
      setMessage(''); 
    }
  };

  const pickAndSendImage = async () => {
    const result = await launchImageLibrary({ mediaType: 'photo', includeBase64: true, quality: 0.5 }); 
    if (result.didCancel || !result.assets) return;

    const base64Image = result.assets[0].base64;
    const mediaId = `image_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const encryptedImage = CryptoJS.AES.encrypt(base64Image, ROOM_SECRET).toString();

    try {
      const response = await fetch(`${SERVER_URL}/upload-media`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: mediaId, payload: encryptedImage })
      });

      if(response.ok) {
        const lifespan = EXPIRATION_MODES[activeMode].time;
        const messageData = { 
          id: Date.now().toString(), encryptedPayload: CryptoJS.AES.encrypt("📷 Secure Image", ROOM_SECRET).toString(), 
          senderId: currentUser, receiverId: activeChatUser.username, expiresAt: lifespan ? Date.now() + lifespan : null, 
          mode: activeMode, mediaId: mediaId, type: 'image', status: 'sent'
        };
        socket.emit('send_private_message', messageData);
        setChat((prev) => [...prev, { ...messageData, text: "📷 Secure Image" }]);
      }
    } catch (e) { Alert.alert("Upload Failed"); }
  };

  // --- RENDERS ---
  if (currentScreen === 'auth') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bgMain} />
        <View style={styles.authCard}>
          <View style={styles.logoContainer}>
             <Text style={styles.logoIcon}>🛡️</Text>
          </View>
          <Text style={styles.authTitle}>Cipher<Text style={styles.authTitleAccent}>Room</Text></Text>
          <Text style={styles.authSubtitle}>End-to-End Encrypted Protocol</Text>
          <View style={styles.inputWrapper}>
            <TextInput style={styles.authInput} placeholder="Username" placeholderTextColor={COLORS.textMuted} value={authUsername} onChangeText={setAuthUsername} autoCapitalize="none" />
            <TextInput style={styles.authInput} placeholder="Password" placeholderTextColor={COLORS.textMuted} value={authPassword} onChangeText={setAuthPassword} secureTextEntry />
          </View>
          <TouchableOpacity style={styles.primaryButton} onPress={handleAuth}><Text style={styles.primaryButtonText}>{isLoginMode ? 'Sign In Securely' : 'Create Identity'}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.switchModeButton} onPress={() => setIsLoginMode(!isLoginMode)}><Text style={styles.switchModeText}>{isLoginMode ? "No account? Initialize here" : "Return to sign in"}</Text></TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (currentScreen === 'home') {
    return (
      <SafeAreaView style={styles.safeContainer}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bgMain} />
        <View style={styles.homeHeader}>
          <View>
            <Text style={styles.headerTitle}>Messages</Text>
            <TouchableOpacity onPress={() => setCurrentScreen('auth')}><Text style={styles.headerSubtitle}>Connected as @{currentUser}</Text></TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.panicBtn}><Text style={styles.panicBtnText}>⚙️</Text></TouchableOpacity>
        </View>

        <ScrollView style={styles.homeBody} showsVerticalScrollIndicator={false}>
          <View style={styles.searchRow}>
            <View style={styles.searchBarContainer}>
               <Text style={styles.searchIcon}>🔍</Text>
               <TextInput style={styles.searchInput} placeholder="Search alias to connect..." placeholderTextColor={COLORS.textMuted} value={searchQuery} onChangeText={setSearchQuery} autoCapitalize="none" />
            </View>
            <TouchableOpacity style={styles.addBtn} onPress={sendFriendRequest}><Text style={styles.addBtnText}>Add</Text></TouchableOpacity>
          </View>

          {pendingRequests.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Incoming Requests</Text>
              {pendingRequests.map((req, i) => (
                <View key={i} style={styles.friendCard}>
                  <Text style={styles.friendName}>{req}</Text>
                  <TouchableOpacity style={styles.acceptBtn} onPress={() => acceptRequest(req)}><Text style={styles.acceptBtnText}>Accept</Text></TouchableOpacity>
                </View>
              ))}
            </>
          )}

          <Text style={styles.sectionTitle}>Secure Vaults</Text>
          <TouchableOpacity style={styles.friendCard} onPress={() => openChat({ username: currentUser, bio: 'Encrypted Personal Notepad' })}>
            <View style={[styles.avatar, {backgroundColor: COLORS.primary}]}><Text style={[styles.avatarText, {color: '#FFF'}]}>🔖</Text></View>
            <View style={{flex: 1, marginLeft: 15}}><Text style={styles.friendName}>Saved Messages</Text><Text style={styles.friendBio} numberOfLines={1}>Personal Encrypted Notepad</Text></View>
          </TouchableOpacity>

          {friends.length === 0 ? <Text style={styles.emptyText}>No connections yet.</Text> : null}
          {friends.map((friend, i) => (
            <TouchableOpacity key={i} style={styles.friendCard} onPress={() => openChat(friend)}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{friend.username.charAt(0).toUpperCase()}</Text></View>
              <View style={{flex: 1, marginLeft: 15}}><Text style={styles.friendName}>{friend.username}</Text><Text style={styles.friendBio} numberOfLines={1}>{friend.bio}</Text></View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (currentScreen === 'chat') {
    return (
      <SafeAreaView style={[styles.safeContainer, { backgroundColor: currentTheme.bg }]}>
        <StatusBar barStyle="light-content" backgroundColor={currentTheme.card} />
        <KeyboardAvoidingView style={styles.keyboardAvoid} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
          
          <View style={[styles.chatHeader, { backgroundColor: currentTheme.card }]}>
            <TouchableOpacity onPress={() => {setCurrentScreen('home'); setActiveMode('off');}} style={styles.backBtn}><Text style={styles.backBtnText}>←</Text></TouchableOpacity>
            <View style={styles.avatarSmall}><Text style={[styles.avatarTextSmall, {color: '#FFF'}]}>{activeChatUser.username === currentUser ? '🔖' : activeChatUser.username.charAt(0).toUpperCase()}</Text></View>
            <View style={{marginLeft: 10}}>
              <Text style={styles.headerText}>{activeChatUser.username === currentUser ? 'Saved Messages' : activeChatUser.username}</Text>
              <Text style={[styles.friendBioSmall, {color: currentTheme.color}]} numberOfLines={1}>{currentTheme.label}</Text>
            </View>
            <View style={{flex: 1}}/>
          </View>

          <FlatList data={chat} keyExtractor={(item) => item.id} 
            renderItem={({ item }) => {
              const alignMe = activeChatUser.username === currentUser ? true : item.senderId === currentUser; 
              const bubbleData = EXPIRATION_MODES[item.mode] || EXPIRATION_MODES['off'];
              
              const bubbleStyleMe = { backgroundColor: bubbleData.bubbleMe, borderBottomRightRadius: 4 };
              const bubbleStyleOther = { backgroundColor: bubbleData.bubbleOther, borderBottomLeftRadius: 4 };

              let checkmarks = "✓";
              let checkColor = "rgba(255,255,255,0.4)";
              if (item.status === 'delivered') checkmarks = "✓✓";
              if (item.status === 'read') { checkmarks = "✓✓"; checkColor = "#60A5FA"; } 

              return (
                <View style={{ alignSelf: alignMe ? 'flex-end' : 'flex-start', marginVertical: 4, maxWidth: '82%' }}>
                  <View style={[styles.messageBubble, alignMe ? bubbleStyleMe : bubbleStyleOther]}>
                    
                    {/* DYNAMIC MEDIA RENDERING (Text, Image, or Audio) */}
                    {item.type === 'audio' ? (
                      <SecureAudioBubble mediaId={item.mediaId} modeData={bubbleData} />
                    ) : item.type === 'image' ? (
                      <SecureMediaBubble mediaId={item.mediaId} modeData={bubbleData} />
                    ) : (
                      <Text style={styles.messageText}>{item.text}</Text>
                    )}

                    {alignMe && activeChatUser.username !== currentUser && (
                      <Text style={{ fontSize: 10, color: checkColor, alignSelf: 'flex-end', marginTop: 2, marginRight: 8, fontWeight: 'bold' }}>{checkmarks}</Text>
                    )}

                  </View>
                </View>
              );
            }} 
            contentContainerStyle={styles.chatContainer} showsVerticalScrollIndicator={false}/>

          <View style={[styles.bottomArea, { backgroundColor: currentTheme.bg, borderTopColor: currentTheme.card }]}>
            
            {showModeMenu && (
              <View style={[styles.modeMenuContainer, {backgroundColor: currentTheme.card}]}>
                {Object.keys(EXPIRATION_MODES).map((modeKey) => (
                  <TouchableOpacity key={modeKey} style={styles.modeMenuItem} onPress={() => { setActiveMode(modeKey); setShowModeMenu(false); }}>
                    <Text style={{fontSize: 16}}>{EXPIRATION_MODES[modeKey].icon}</Text>
                    <Text style={{color: '#FFF', marginLeft: 10, fontWeight: activeMode === modeKey ? 'bold' : 'normal'}}>{EXPIRATION_MODES[modeKey].label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.inputContainer}>
              <TouchableOpacity onPress={pickAndSendImage} style={styles.mediaBtn}><Text style={{fontSize: 20}}>📎</Text></TouchableOpacity>
              
              <TextInput style={[styles.input, {backgroundColor: currentTheme.card}]} value={message} onChangeText={setMessage} placeholder={isRecording ? "Recording..." : "Message..."} placeholderTextColor={COLORS.textMuted} multiline editable={!isRecording}/>
              
              <TouchableOpacity style={styles.timerToggleBtn} onPress={() => setShowModeMenu(!showModeMenu)}><Text style={{fontSize: 18}}>{currentTheme.icon}</Text></TouchableOpacity>
              
              {/* VOICE RECORDING LOGIC */}
              {message.trim().length === 0 ? (
                 <TouchableOpacity 
                   style={[styles.sendButton, {backgroundColor: isRecording ? '#EF4444' : COLORS.bgInput}]} 
                   onPressIn={startRecording} 
                   onPressOut={stopRecordingAndSend}
                 >
                   <Text style={{fontSize: 18}}>{isRecording ? '⏹️' : '🎙️'}</Text>
                 </TouchableOpacity>
              ) : (
                 <TouchableOpacity style={[styles.sendButton, {backgroundColor: currentTheme.color}]} onPress={sendMessage}>
                   <Text style={{color: '#FFF', fontSize: 18, fontWeight: 'bold'}}>↗</Text>
                 </TouchableOpacity>
              )}
            </View>
          </View>

        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }
}

// --- BEAUTIFUL PREMIUM STYLESHEET ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgMain, justifyContent: 'center' },
  safeContainer: { flex: 1, backgroundColor: COLORS.bgMain, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  keyboardAvoid: { flex: 1 },
  
  // Auth Overhaul
  authCard: { width: '100%', maxWidth: 400, alignSelf: 'center', padding: 30 },
  logoContainer: { width: 64, height: 64, backgroundColor: COLORS.bgCard, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 24, shadowColor: '#000', shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.2, shadowRadius: 10 },
  logoIcon: { fontSize: 32 },
  authTitle: { color: COLORS.textMain, fontSize: 36, fontWeight: '800', letterSpacing: -0.5 },
  authTitleAccent: { color: COLORS.primary },
  authSubtitle: { color: COLORS.textMuted, fontSize: 16, marginBottom: 40, marginTop: 8 },
  inputWrapper: { gap: 16, marginBottom: 32 },
  authInput: { backgroundColor: COLORS.bgCard, color: COLORS.textMain, borderRadius: 16, padding: 18, fontSize: 16 },
  primaryButton: { backgroundColor: COLORS.primary, padding: 18, borderRadius: 16, alignItems: 'center', shadowColor: COLORS.primary, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  primaryButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  switchModeButton: { marginTop: 24, alignItems: 'center', padding: 10 },
  switchModeText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '500' },

  // Home Screen Overhaul
  homeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 20 },
  headerTitle: { color: COLORS.textMain, fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  headerSubtitle: { color: COLORS.primary, fontSize: 14, fontWeight: '600', marginTop: 4 },
  panicBtn: { backgroundColor: COLORS.bgCard, padding: 12, borderRadius: 20 },
  panicBtnText: { fontSize: 20 },
  homeBody: { paddingHorizontal: 24 },
  
  searchRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  searchBarContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bgCard, borderRadius: 16, paddingHorizontal: 16 },
  searchIcon: { fontSize: 18, marginRight: 10 },
  searchInput: { flex: 1, color: COLORS.textMain, paddingVertical: 16, fontSize: 16 },
  addBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 24, justifyContent: 'center', borderRadius: 16 },
  addBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  
  sectionTitle: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginBottom: 16, marginTop: 30, letterSpacing: 1 },
  friendCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  friendName: { color: COLORS.textMain, fontSize: 18, fontWeight: '600' },
  friendBio: { color: COLORS.textMuted, fontSize: 14, marginTop: 4 },
  acceptBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
  acceptBtnText: { color: '#FFF', fontWeight: 'bold' },
  emptyText: { color: COLORS.textMuted, fontStyle: 'italic', marginTop: 10 },
  
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: COLORS.bgCard, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: COLORS.primary, fontSize: 20, fontWeight: 'bold' },

  // Chat Screen Overhaul
  chatHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  backBtn: { padding: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20 },
  backBtnText: { color: COLORS.textMain, fontSize: 18, fontWeight: 'bold' },
  avatarSmall: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center', marginLeft: 12 },
  avatarTextSmall: { fontSize: 18, fontWeight: 'bold' },
  headerText: { color: COLORS.textMain, fontSize: 18, fontWeight: '700' },
  friendBioSmall: { fontSize: 13, marginTop: 2, fontWeight: '600' },
  chatContainer: { padding: 16, flexGrow: 1, justifyContent: 'flex-end' },
  
  messageBubble: { padding: 6, borderRadius: 22, flexDirection: 'column', alignItems: 'flex-start', overflow: 'hidden' }, 
  messageText: { fontSize: 16, color: '#FFF', marginHorizontal: 14, marginTop: 8, marginBottom: 4, lineHeight: 24 },
  
  // Audio Play Button Wrapper
  playButtonWrapper: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },

  // Fixed Bottom Area
  bottomArea: { borderTopWidth: 1, paddingTop: 12, paddingBottom: Platform.OS === 'android' ? 40 : 24 },
  inputContainer: { flexDirection: 'row', paddingHorizontal: 16, alignItems: 'center', gap: 10 },
  input: { flex: 1, color: COLORS.textMain, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12, fontSize: 16, maxHeight: 120 },
  mediaBtn: { padding: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20 },
  timerToggleBtn: { padding: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20 },
  sendButton: { width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center' },
  
  modeMenuContainer: { position: 'absolute', bottom: 80, right: 24, borderRadius: 20, padding: 8, elevation: 10, shadowColor: '#000', shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.4, shadowRadius: 15, zIndex: 100, width: 220 },
  modeMenuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
});
