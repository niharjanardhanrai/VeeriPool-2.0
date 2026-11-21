import axios from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// In Expo Go / dev client, hostUri is "<lan-ip>:<metro-port>" — reusing the
// same LAN IP lets a phone on the same Wi-Fi reach the backend running on
// this machine without hardcoding an address.
function resolveHost() {
  const hostUri =
    Constants.expoConfig?.hostUri || Constants.expoGoConfig?.debuggerHost;
  if (hostUri) {
    return hostUri.split(':')[0];
  }
  return Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
}

export const API_HOST = resolveHost();
export const API_PORT = 5050;
export const API_BASE_URL = `http://${API_HOST}:${API_PORT}/api`;
export const SOCKET_URL = `http://${API_HOST}:${API_PORT}`;

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

client.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('veripool2_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default client;
