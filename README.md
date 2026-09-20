# Vikunja Mobile (TickTick-Grade UX)

A modern, high-performance mobile client for the [Vikunja](https://vikunja.io) open-source task and project management backend. Built with React Native & Expo, engineered with **strict TDD**, and designed to deliver the tactile, zero-latency experience of **TickTick**.

---

## 🎯 Key UX Features (TickTick Standards)

1. **0ms Optimistic UI & Offline Sync Engine**:
   - Ticking off tasks, creating tasks, and moving items happen instantly with 0ms UI latency.
   - Background mutation queue persists changes and synchronizes with Vikunja's REST API with automatic error recovery and retry backoff.
2. **Rapid Chained Task Entry (`QuickAddBar`)**:
   - Persistent bottom input bar designed for rapid consecutive capture.
   - Typing and pressing return adds the task immediately and keeps the keyboard ready for the next task.
   - Quick priority cycling flags (`!`, `!!`, `!!!`, `!!!!`).
3. **Tactile Gestures & Haptics (`SwipeableTaskItem`)**:
   - Swipe Right: Instant task toggle completion with green checkmark animation and success haptics.
   - Swipe Left: Reveals "Move to List" and "Delete" actions.
   - Priority strip indicator color-coded by task urgency.
4. **1-Tap List Reallocation (`MoveListModal`)**:
   - Effortlessly relocate any task to another project/list in a single tap without nested modal navigation.
5. **Fast List Switching Drawer (`ProjectDrawer`)**:
   - Slide-in list switcher showing active task counts, custom project colors, and project navigation.

---

## 🛠️ Tech Stack & Architecture

- **Mobile Framework**: React Native + Expo (TypeScript)
- **State & Optimistic Store**: Zustand + local mutation sync queue
- **Gestures & Animations**: `react-native-gesture-handler` + `react-native-reanimated` + `expo-haptics`
- **Networking**: Typed Vikunja REST API Client (v1)
- **Testing**: Jest + `@testing-library/react-native` (Full TDD coverage)

---

## 🧪 Testing (TDD)

Run the full unit and integration test suite:

```bash
# Run all tests
npm test

# Run tests with code coverage
npm run test:coverage

# TypeScript verification
npm run typecheck
```

---

## 🚀 Running the App

```bash
# Start development server
npm start

# Run on Android (device or emulator)
npm run android

# Run on iOS (simulator or device)
npm run ios

# Run web preview
npm run web
```
