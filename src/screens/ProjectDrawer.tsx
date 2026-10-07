import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
  Platform,
  StatusBar,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTaskStore } from '../store/taskStore';
import { safeHaptics } from '../utils/haptics';
import { useAppTheme } from '../utils/theme';
import { SettingsModal } from '../components/SettingsModal';
import { LabelManagementModal } from '../components/LabelManagementModal';
import { ProjectEditorModal } from '../components/ProjectEditorModal';
import { ProjectSharingModal } from '../components/ProjectSharingModal';
import { Project } from '../types/vikunja';
import { buildProjectTree, flattenProjectTree } from '../utils/projectTree';

import { MY_TASKS_PROJECT_ID, isTaskAssignedToUser } from '../utils/taskFilters';

interface ProjectDrawerProps {
  visible: boolean;
  onClose: () => void;
  onAddNewList?: () => void;
  onLogout?: () => void;
  inline?: boolean;
}

export const ProjectDrawer: React.FC<ProjectDrawerProps> = ({
  visible,
  onClose,
  onAddNewList,
  onLogout,
  inline = false,
}) => {
  const theme = useAppTheme();
  const {
    projects,
    tasks,
    currentUser,
    selectedProjectId,
    setSelectedProjectId,
    toggleProjectFavorite,
  } = useTaskStore();

  const [showSettings, setShowSettings] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editorProject, setEditorProject] = useState<Project | null>(null);
  const [sharingProject, setSharingProject] = useState<Project | null>(null);
  const [actionSheetProject, setActionSheetProject] = useState<Project | null>(null);

  const handleSelect = (id: number | null) => {
    safeHaptics.selection();
    setSelectedProjectId(id);
    onClose();
  };

  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeTasks = Array.isArray(tasks) ? tasks : [];

  const drawerContent = (
    <SafeAreaView
      style={[
        inline ? styles.inlineContainer : styles.drawerContainer,
        {
          backgroundColor: theme.colors.cardBackground,
          borderRightColor: theme.colors.cardBorder,
        },
      ]}
      edges={['top', 'bottom', 'left']}
    >
      {/* Drawer Header */}
      <View style={[styles.header, { borderBottomColor: theme.colors.cardBorder }]}>
        <View style={styles.brandRow}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logoImage}
            resizeMode="cover"
          />
          <Text style={[styles.brandTitle, { color: theme.colors.text }]}>Lists</Text>
        </View>
        {!inline && (
          <TouchableOpacity
            testID="drawer-close-btn"
            style={styles.closeBtn}
            onPress={onClose}
          >
            <Text style={[styles.closeBtnText, { color: theme.colors.textSecondary }]}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

          {/* Project List */}
          <ScrollView style={styles.projectList}>
            {/* All Tasks Master View (TickTick style) */}
            <TouchableOpacity
              testID="drawer-project-all"
              style={[
                styles.projectItem,
                selectedProjectId === null && {
                  backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                },
              ]}
              onPress={() => handleSelect(null)}
              activeOpacity={0.7}
            >
              <View style={[styles.colorDot, { backgroundColor: '#007AFF' }]} />
              <Text
                style={[
                  styles.projectTitle,
                  { color: theme.colors.text },
                  selectedProjectId === null && styles.projectTitleSelected,
                ]}
                numberOfLines={1}
              >
                All Tasks
              </Text>
              <Text
                testID="drawer-count-all"
                style={styles.badgeCount}
              >
                {safeTasks.filter((t) => !t.done).length}
              </Text>
            </TouchableOpacity>

            {/* My Open Tasks View */}
            <TouchableOpacity
              testID="drawer-project-my-tasks"
              style={[
                styles.projectItem,
                selectedProjectId === MY_TASKS_PROJECT_ID && {
                  backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                },
              ]}
              onPress={() => handleSelect(MY_TASKS_PROJECT_ID)}
              activeOpacity={0.7}
            >
              <View style={[styles.colorDot, { backgroundColor: '#AF52DE' }]} />
              <Text
                style={[
                  styles.projectTitle,
                  { color: theme.colors.text },
                  selectedProjectId === MY_TASKS_PROJECT_ID && styles.projectTitleSelected,
                ]}
                numberOfLines={1}
              >
                My Open Tasks
              </Text>
              <Text
                testID="drawer-count-my-tasks"
                style={styles.badgeCount}
              >
                {safeTasks.filter((t) => !t.done && isTaskAssignedToUser(t, currentUser)).length}
              </Text>
            </TouchableOpacity>

            {/* Individual Lists with Tree Hierarchy */}
            {(() => {
              const visibleProjects = safeProjects.filter((p) => p.id > 0 && !p.is_archived);
              const treeNodes = buildProjectTree(visibleProjects);
              const flattened = flattenProjectTree(treeNodes);

              return flattened.map((node) => {
                const proj = node.project;
                const isSelected = proj.id === selectedProjectId;
                const activeTasks = safeTasks.filter(
                  (t) => t.project_id === proj.id && !t.done
                ).length;
                const indentPadding = Math.min(node.depth * 14, 42);

                return (
                  <View
                    key={proj.id}
                    style={[
                      styles.projectItemWrapper,
                      isSelected && {
                        backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                      },
                    ]}
                  >
                    <TouchableOpacity
                      testID={`drawer-project-${proj.id}`}
                      style={[
                        styles.projectItem,
                        { paddingLeft: 12 + indentPadding },
                      ]}
                      onPress={() => handleSelect(proj.id)}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.colorDot,
                          { backgroundColor: proj.hex_color ? `#${proj.hex_color.replace(/^#/, '')}` : '#007AFF' },
                        ]}
                      />
                      <Text
                        style={[
                          styles.projectTitle,
                          { color: theme.colors.text },
                          isSelected && styles.projectTitleSelected,
                        ]}
                        numberOfLines={1}
                      >
                        {proj.is_favorite ? '⭐ ' : ''}
                        {proj.title}
                      </Text>
                      {activeTasks > 0 && (
                        <Text
                          testID={`drawer-count-${proj.id}`}
                          style={styles.badgeCount}
                        >
                          {activeTasks}
                        </Text>
                      )}
                    </TouchableOpacity>

                    {/* List Options Menu Trigger */}
                    <TouchableOpacity
                      testID={`drawer-project-options-${proj.id}`}
                      style={styles.optionsBtn}
                      onPress={() => {
                        safeHaptics.selection();
                        setActionSheetProject(proj);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[styles.optionsBtnText, { color: theme.colors.textSecondary }]}>⋯</Text>
                    </TouchableOpacity>
                  </View>
                );
              });
            })()}
          </ScrollView>

          {/* Quick Add List button */}
          <TouchableOpacity
            testID="drawer-add-list-btn"
            style={[styles.addListBtn, { borderTopColor: theme.colors.cardBorder }]}
            onPress={() => {
              safeHaptics.selection();
              if (onAddNewList) {
                onAddNewList();
              } else {
                setEditorProject(null);
                setShowEditor(true);
              }
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.addListIcon}>＋</Text>
            <Text style={styles.addListText}>New List</Text>
          </TouchableOpacity>

          {/* Settings Section at bottom */}
          <View style={[styles.footerSection, { borderTopColor: theme.colors.cardBorder }]}>
            <TouchableOpacity
              testID="drawer-settings-btn"
              style={[
                styles.settingsBtn,
                { backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA' },
              ]}
              onPress={() => {
                safeHaptics.selection();
                setShowSettings(true);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.settingsIcon}>⚙️</Text>
              <Text style={[styles.settingsText, { color: theme.colors.text }]}>Settings</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
  );

  const sharedModals = (
    <>
      <SettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        onLogout={onLogout}
        onOpenLabelManagement={() => setShowLabels(true)}
      />

      <LabelManagementModal
        visible={showLabels}
        onClose={() => setShowLabels(false)}
      />

      <ProjectEditorModal
        visible={showEditor}
        project={editorProject}
        allProjects={safeProjects}
        onClose={() => {
          setShowEditor(false);
          setEditorProject(null);
        }}
      />

      <ProjectSharingModal
        visible={Boolean(sharingProject)}
        project={sharingProject}
        onClose={() => setSharingProject(null)}
      />

      {/* Project Options Action Sheet */}
      {actionSheetProject && (
        <Modal
          visible={Boolean(actionSheetProject)}
          transparent
          animationType="fade"
          onRequestClose={() => setActionSheetProject(null)}
        >
          <TouchableWithoutFeedback onPress={() => setActionSheetProject(null)}>
            <View style={styles.actionSheetBackdrop}>
              <TouchableWithoutFeedback>
                <View
                  style={[
                    styles.actionSheetCard,
                    {
                      backgroundColor: theme.colors.card,
                      borderColor: theme.colors.cardBorder,
                    },
                  ]}
                >
                  <Text style={[styles.actionSheetTitle, { color: theme.colors.text }]}>
                    {actionSheetProject.title}
                  </Text>

                  <TouchableOpacity
                    testID="drawer-option-edit"
                    style={[styles.actionSheetOption, { borderBottomColor: theme.colors.border }]}
                    onPress={() => {
                      const p = actionSheetProject;
                      setActionSheetProject(null);
                      setEditorProject(p);
                      setShowEditor(true);
                    }}
                  >
                    <Text style={[styles.actionSheetOptionText, { color: theme.colors.text }]}>
                      ✏️ Edit List
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    testID="drawer-option-share"
                    style={[styles.actionSheetOption, { borderBottomColor: theme.colors.border }]}
                    onPress={() => {
                      const p = actionSheetProject;
                      setActionSheetProject(null);
                      setSharingProject(p);
                    }}
                  >
                    <Text style={[styles.actionSheetOptionText, { color: theme.colors.text }]}>
                      👥 Share List
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    testID="drawer-option-favorite"
                    style={[styles.actionSheetOption, { borderBottomColor: theme.colors.border }]}
                    onPress={() => {
                      toggleProjectFavorite(actionSheetProject.id);
                      setActionSheetProject(null);
                    }}
                  >
                    <Text style={[styles.actionSheetOptionText, { color: theme.colors.text }]}>
                      {actionSheetProject.is_favorite ? '⭐ Remove Favorite' : '☆ Mark as Favorite'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionSheetCancel}
                    onPress={() => setActionSheetProject(null)}
                  >
                    <Text style={[styles.actionSheetCancelText, { color: theme.colors.textSecondary }]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}
    </>
  );

  if (inline) {
    return (
      <View style={styles.inlineRoot}>
        {drawerContent}
        {sharedModals}
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {drawerContent}
        <TouchableWithoutFeedback testID="drawer-backdrop" onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>
      </View>
      {sharedModals}
    </Modal>
  );
};

const styles = StyleSheet.create({
  inlineRoot: {
    flex: 1,
    width: '100%',
  },
  inlineContainer: {
    flex: 1,
    width: '100%',
    borderRightWidth: 1,
    display: 'flex',
  },
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  drawerContainer: {
    width: '80%',
    backgroundColor: '#161618',
    borderRightWidth: 1,
    borderRightColor: '#2C2C2E',
    display: 'flex',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2C2C2E',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoImage: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    color: '#8E8E93',
    fontSize: 18,
    fontWeight: '600',
  },
  projectList: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 4,
  },
  projectItemSelected: {
    backgroundColor: '#2C2C2E',
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  projectTitle: {
    flex: 1,
    fontSize: 16,
    color: '#E5E5EA',
    fontWeight: '500',
  },
  projectTitleSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  badgeCount: {
    fontSize: 13,
    color: '#8E8E93',
    fontWeight: '600',
    paddingHorizontal: 6,
  },
  addListBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#2C2C2E',
    gap: 10,
  },
  addListIcon: {
    fontSize: 20,
    color: '#007AFF',
    fontWeight: '700',
  },
  addListText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  footerSection: {
    borderTopWidth: 1,
    borderTopColor: '#2C2C2E',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  settingLabel: {
    color: '#E5E5EA',
    fontSize: 14,
    fontWeight: '500',
  },
  resetSyncBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#2C2C2E',
    borderWidth: 1,
    borderColor: '#3A3A3C',
    marginVertical: 4,
  },
  resetSyncBtnDisabled: {
    opacity: 0.6,
  },
  resetSyncBtnSuccess: {
    backgroundColor: 'rgba(48, 209, 88, 0.15)',
    borderColor: '#30D158',
  },
  resetSyncContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  resetSyncIcon: {
    fontSize: 18,
  },
  resetSyncTextContainer: {
    flex: 1,
  },
  resetSyncTitle: {
    color: '#F2F2F7',
    fontSize: 13,
    fontWeight: '600',
  },
  resetSyncSubtitle: {
    color: '#8E8E93',
    fontSize: 11,
    marginTop: 1,
  },
  resetSyncText: {
    color: '#0A84FF',
    fontSize: 13,
    fontWeight: '600',
  },
  resetSyncSuccessText: {
    color: '#30D158',
    fontSize: 13,
    fontWeight: '700',
  },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    gap: 10,
  },
  settingsIcon: {
    fontSize: 18,
  },
  settingsText: {
    fontSize: 15,
    fontWeight: '600',
  },
  projectItemWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    marginBottom: 4,
  },
  optionsBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionsBtnText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  actionSheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  actionSheetCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    paddingVertical: 8,
  },
  actionSheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  actionSheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionSheetOptionText: {
    fontSize: 15,
    fontWeight: '500',
  },
  actionSheetCancel: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionSheetCancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
