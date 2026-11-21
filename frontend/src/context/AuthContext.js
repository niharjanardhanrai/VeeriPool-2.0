import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../api/client';
import { connectSocket, disconnectSocket } from '../api/socket';

const AuthContext = createContext(null);
const TOKEN_KEY = 'veripool2_token';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      if (token) {
        try {
          const { data } = await client.get('/auth/me');
          setUser(data.user);
          connectSocket(token);
        } catch {
          await AsyncStorage.removeItem(TOKEN_KEY);
        }
      }
      setIsLoading(false);
    })();
  }, []);

  // Sec. II-B.1.c: login is by the auto-generated username, but we also
  // accept an email so the demo works either way.
  async function login(identifier, password) {
    const payload = identifier.includes('@') ? { email: identifier, password } : { username: identifier, password };
    const { data } = await client.post('/auth/login', payload);
    await AsyncStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    connectSocket(data.token);
    return data;
  }

  // Registering never logs the user in directly — it sends an OTP and
  // waits for verifyOtp(). `payload` is a FormData when it includes a
  // driver's license photo, a plain object otherwise.
  async function register(payload) {
    const isFormData = typeof FormData !== 'undefined' && payload instanceof FormData;
    const { data } = await client.post('/auth/register', payload, isFormData ? {} : undefined);
    return data;
  }

  // Automated version of Sec. II-B.1.b: confirms the emailed code, and
  // either logs the user straight in (rider, or a license-verified driver)
  // or returns without a token (a driver flagged for admin review).
  async function verifyOtp(identifier, code) {
    const payload = identifier.includes('@') ? { email: identifier, code } : { username: identifier, code };
    const { data } = await client.post('/auth/verify-otp', payload);
    if (data.token) {
      await AsyncStorage.setItem(TOKEN_KEY, data.token);
      setUser(data.user);
      connectSocket(data.token);
    }
    return data;
  }

  async function resendOtp(identifier) {
    const payload = identifier.includes('@') ? { email: identifier } : { username: identifier };
    const { data } = await client.post('/auth/resend-otp', payload);
    return data;
  }

  // On web every tab shares one localStorage, so logging in or out in one
  // tab silently swaps the token the other tabs send. Follow the change so
  // a tab never shows one account while acting as another.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return undefined;
    async function onStorage(e) {
      if (e.key !== TOKEN_KEY) return;
      if (!e.newValue) {
        disconnectSocket();
        setUser(null);
        return;
      }
      try {
        const { data } = await client.get('/auth/me');
        setUser(data.user);
        disconnectSocket();
        connectSocket(e.newValue);
      } catch {
        setUser(null);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  async function refreshMe() {
    const { data } = await client.get('/auth/me');
    setUser(data.user);
    return data.user;
  }

  async function logout() {
    await AsyncStorage.removeItem(TOKEN_KEY);
    disconnectSocket();
    setUser(null);
  }

  const value = useMemo(
    () => ({ user, isLoading, login, register, verifyOtp, resendOtp, logout, refreshMe, setUser }),
    [user, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
