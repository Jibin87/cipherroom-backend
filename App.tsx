import React, { useState, useEffect } from 'react';
import { 
  SafeAreaView, 
  View, 
  TextInput, 
  TouchableOpacity, 
  FlatList, 
  Text, 
  StyleSheet, 
  KeyboardAvoidingView, 
  Platform 
} from 'react-native';
import io from 'socket.io-client';

// Connect to the local Node.js server
const SERVER_URL = 'http://10.0.2.2:3000'; 
const socket = io(SERVER_URL);

export default function App() {
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState<{ id: string; text: string }[]>([]);

  useEffect(() => {
    // Listen for incoming messages from the server
    socket.on('receive_message', (data) => {
      setChat((prevChat) => [...prevChat, data]);
    });

    // Cleanup listener on unmount
    return () => {
      socket.off('receive_message');
    };
  }, []);

  const sendMessage = () => {
    if (message.trim()) {
      const messageData = { 
        id: Date.now().toString(), 
        text: message 
      };
      
      // Send the message to the server
      socket.emit('send_message', messageData);
      setMessage(''); // Clear input
    }
  };

  const renderItem = ({ item }) => (
    <View style={styles.messageBubble}>
      <Text style={styles.messageText}>{item.text}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        style={styles.keyboardAvoid} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.headerText}>MVP Secure Chat</Text>
        </View>

        <FlatList
          data={chat}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.chatContainer}
        />

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={message}
            onChangeText={setMessage}
            placeholder="Type a message..."
            placeholderTextColor="#888"
          />
          <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  keyboardAvoid: { flex: 1 },
  header: { padding: 15, backgroundColor: '#1e1e1e', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#333' },
  headerText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  chatContainer: { padding: 10, flexGrow: 1, justifyContent: 'flex-end' },
  messageBubble: { backgroundColor: '#007AFF', padding: 12, borderRadius: 15, marginVertical: 5, alignSelf: 'flex-end', maxWidth: '80%' },
  messageText: { color: '#fff', fontSize: 16 },
  inputContainer: { flexDirection: 'row', padding: 10, backgroundColor: '#1e1e1e', borderTopWidth: 1, borderTopColor: '#333' },
  input: { flex: 1, backgroundColor: '#2c2c2c', color: '#fff', borderRadius: 20, paddingHorizontal: 15, paddingVertical: 10, fontSize: 16 },
  sendButton: { justifyContent: 'center', alignItems: 'center', marginLeft: 10, backgroundColor: '#007AFF', borderRadius: 20, paddingHorizontal: 20 },
  sendButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});