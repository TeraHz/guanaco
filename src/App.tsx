import React, { useState, useEffect } from 'react';
import { StyleSheet, View, AppState, Platform, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import { initNotifications } from './services/localNotifications';

export default function App() {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const { initialize, syncAll } = useTaskStore();

  useEffect(() => {
    initNotifications().catch(() => {});
  }, []);

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

    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => {
        if (AppState.currentState === 'active') {
          syncAll().catch(() => {});
        }
      }, 60000); // 60s active polling interval
    };

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    // Start polling initially if active
    if (AppState.currentState === 'active') {
      startPolling();
    }

    // React Native AppState listener
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        syncAll().catch(() => {});
        startPolling();
      } else {
        stopPolling();
      }
    });

    // Web window focus / blur listener
    let handleFocus: (() => void) | null = null;
    let handleBlur: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      handleFocus = () => {
        syncAll().catch(() => {});
        startPolling();
      };
      handleBlur = () => {
        stopPolling();
      };
      window.addEventListener('focus', handleFocus);
      window.addEventListener('blur', handleBlur);
    }

    return () => {
      subscription.remove();
      stopPolling();
      if (handleFocus && typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
      }
      if (handleBlur && typeof window !== 'undefined') {
        window.removeEventListener('blur', handleBlur);
      }
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
    <SafeAreaProvider style={{ flex: 1 }}>
      <GestureHandlerRootView
        style={[styles.root, { backgroundColor: theme.colors.background }]}
      >
        <StatusBar style={theme.isDark ? 'light' : 'dark'} />
        {!isAuthenticated ? (
          <LoginScreen onConnect={handleConnect} />
        ) : isTablet ? (
          <View style={styles.tabletRoot}>
            <View style={[styles.tabletSidebar, { borderRightColor: theme.colors.cardBorder }]}>
              <ProjectDrawer
                visible={true}
                inline={true}
                onClose={() => {}}
                onLogout={handleLogout}
              />
            </View>
            <View style={styles.tabletContent}>
              <ProjectTasksScreen
                hideDrawerButton={true}
                onOpenDrawer={() => {}}
              />
            </View>
          </View>
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
    </SafeAreaProvider>
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
  tabletRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  tabletSidebar: {
    width: 320,
    maxWidth: '35%',
    borderRightWidth: 1,
  },
  tabletContent: {
    flex: 1,
  },
});
