module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
  fakeTimers: {
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate'],
  },
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/', '/dist/', '/.expo/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|lucide-react-native|zustand)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
