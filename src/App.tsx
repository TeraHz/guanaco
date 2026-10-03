import React, { useState, useEffect } from 'react';
import { StyleSheet, View, AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { useTaskStore } from './store/taskStore';
import { LoginScreen } from './screens/LoginScreen';
import { ProjectTasksScreen } from './screens/ProjectTasksScreen';
import { ProjectDrawer } from './screens/ProjectDrawer';
import { VikunjaClient } from './api/client';
import { useAppTheme } from './utils/theme';
import {
  getStoredAuth,
  setStoredAuth,
  clearStoredAuth,
  isBiometricEnabled,
  authenticateWithBiometrics,
} from './utils/biometrics';

export default function App() {
  const theme = useAppTheme();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const { initialize, syncAll } = useTaskStore();

  // Auto-restore session from stored token and check biometrics (Reload & App launch)
  useEffect(() => {
    async function restoreSession() {
      const stored = await getStoredAuth();
      if (!stored.token || !stored.serverUrl) return;

      const biometricActive = await isBiometricEnabled();
      if (biometricActive) {
        const passed = await authenticateWithBiometrics('Unlock Guanaco');
        if (!passed) return;
      }

      // Load cached data first for 0ms immediate offline rendering
      await initialize(stored.serverUrl, stored.token);
      setIsAuthenticated(true);

      // Trigger bi-directional sync (push outbound queue, pull all remote tasks & lists)
      syncAll().catch(() => {});
    }
    restoreSession();
  }, []);

  // Bi-directional sync when app returns from background or window gains focus
  useEffect(() => {
    if (!isAuthenticated) return;

    // React Native AppState listener
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        syncAll().catch(() => {});
      }
    });

    // Web window focus listener
    let handleFocus: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      handleFocus = () => {
        syncAll().catch(() => {});
      };
      window.addEventListener('focus', handleFocus);
    }

    // Periodic sync every 30 seconds
    const interval = setInterval(() => {
      syncAll().catch(() => {});
    }, 30000);

    return () => {
      subscription.remove();
      if (handleFocus && typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
      }
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  const handleConnect = async (serverUrl: string, username: string, pass: string) => {
    // Authenticate with Vikunja
    const tempClient = new VikunjaClient({ baseUrl: serverUrl });
    const auth = await tempClient.login(username, pass);

    // Save token & URL to persistent storage
    await setStoredAuth(auth.token, serverUrl);

    // Initialize task store with authenticated client & sync queue
    await initialize(serverUrl, auth.token);

    setIsAuthenticated(true);

    // Run full bidirectional sync (push queue & pull projects and all tasks)
    syncAll().catch(() => {});
  };

  const handleLogout = async () => {
    await clearStoredAuth();
    setIsAuthenticated(false);
    await useTaskStore.getState().clearSession();
  };

  useEffect(() => {
    const unsub = useTaskStore.subscribe((state, prev) => {
      if (prev.client && !state.client) {
        clearStoredAuth().catch(() => {});
        setIsAuthenticated(false);
      }
    });
    return unsub;
  }, []);

  return (
    <GestureHandlerRootView
      style={[styles.root, { backgroundColor: theme.colors.background }]}
    >
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      {!isAuthenticated ? (
        <LoginScreen onConnect={handleConnect} />
      ) : (
        <View style={styles.content}>
          <ProjectTasksScreen onOpenDrawer={() => setIsDrawerOpen(true)} />
          <ProjectDrawer
            visible={isDrawerOpen}
            onClose={() => setIsDrawerOpen(false)}
            onLogout={handleLogout}
          />
        </View>
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0D0D0E',
  },
  content: {
    flex: 1,
  },
});
