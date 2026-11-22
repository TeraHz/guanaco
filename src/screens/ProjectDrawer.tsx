import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTaskStore } from '../store/taskStore';
import * as Haptics from 'expo-haptics';
import { safeHaptics } from '../utils/haptics';
import { useAppTheme } from '../utils/theme';
import { normalizeHexColor } from '../utils/colors';
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
    archiveProject,
  } = useTaskStore();

  const [showSettings, setShowSettings] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editorProjectId, setEditorProjectId] = useState<number | null>(null);
  const [sharingProjectId, setSharingProjectId] = useState<number | null>(null);
  const [actionSheetProjectId, setActionSheetProjectId] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Strict modal mutual exclusion so NEVER are two <Modal>s visible simultaneously on iOS!
  const openExclusiveSubModal = (
    target: 'settings' | 'labels' | 'editor' | 'sharing' | 'actionSheet' | 'none',
    projectId: number | null = null
  ) => {
    setShowSettings(target === 'settings');
    setShowLabels(target === 'labels');
    setShowEditor(target === 'editor');
    setEditorProjectId(target === 'editor' ? projectId : null);
    setSharingProjectId(target === 'sharing' ? projectId : null);
    setActionSheetProjectId(target === 'actionSheet' ? projectId : null);
  };

  const hasActiveSubModal =
    showSettings ||
    showLabels ||
    showEditor ||
    sharingProjectId !== null ||
    actionSheetProjectId !== null;

  const shouldComputeDrawer = visible || inline;

  const safeProjects = useMemo(
    () => (Array.isArray(projects) ? projects : []),
    [projects]
  );

  // Live entity lookup by ID (never stale project snapshots!)
  const editorProject: Project | null = useMemo(
    () =>
      editorProjectId !== null
        ? safeProjects.find((p) => p.id === editorProjectId) || null
        : null,
    [safeProjects, editorProjectId]
  );

  const sharingProject: Project | null = useMemo(
    () =>
      sharingProjectId !== null
        ? safeProjects.find((p) => p.id === sharingProjectId) || null
        : null,
    [safeProjects, sharingProjectId]
  );

  const actionSheetProject: Project | null = useMemo(
    () =>
      actionSheetProjectId !== null
        ? safeProjects.find((p) => p.id === actionSheetProjectId) || null
        : null,
    [safeProjects, actionSheetProjectId]
  );

  // Skip O(Tasks) & O(Projects) calculations completely when drawer is closed on phone!
  const { allActiveCount, myActiveCount, projectActiveCounts } = useMemo(() => {
    if (!shouldComputeDrawer) {
      return {
        allActiveCount: 0,
        myActiveCount: 0,
        projectActiveCounts: new Map<number, number>(),
      };
    }
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    let allCount = 0;
    let myCount = 0;
    const byProject = new Map<number, number>();

    for (let i = 0; i < safeTasks.length; i++) {
      const t = safeTasks[i];
      if (!t.done) {
        allCount++;
        if (isTaskAssignedToUser(t, currentUser)) {
          myCount++;
        }
        byProject.set(t.project_id, (byProject.get(t.project_id) || 0) + 1);
      }
    }

    return {
      allActiveCount: allCount,
      myActiveCount: myCount,
      projectActiveCounts: byProject,
    };
  }, [shouldComputeDrawer, tasks, currentUser]);

  const { flattenedActiveTree, archivedProjects } = useMemo(() => {
    if (!shouldComputeDrawer) {
      return { flattenedActiveTree: [], archivedProjects: [] as Project[] };
    }
    const active = safeProjects.filter((p) => p.id > 0 && !p.is_archived);
    const archived = safeProjects
      .filter((p) => p.id > 0 && Boolean(p.is_archived))
      .sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));

    const treeNodes = buildProjectTree(active);
    return {
      flattenedActiveTree: flattenProjectTree(treeNodes),
      archivedProjects: archived,
    };
  }, [shouldComputeDrawer, safeProjects]);

  const handleSelect = (id: number | null) => {
    safeHaptics.selection();
    setSelectedProjectId(id);
    onClose();
  };

  if (!visible && !inline && !hasActiveSubModal) {
    return null;
  }

  const drawerContent = shouldComputeDrawer ? (
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
            accessibilityRole="button"
            accessibilityLabel="Close lists drawer"
          >
            <Text style={[styles.closeBtnText, { color: theme.colors.textSecondary }]}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Project List */}
      <ScrollView style={styles.projectList}>
        {/* All Tasks Master View */}
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
          accessibilityRole="button"
          accessibilityState={{ selected: selectedProjectId === null }}
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
            style={[styles.badgeCount, { color: theme.colors.textSecondary }]}
          >
            {allActiveCount}
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
          accessibilityRole="button"
          accessibilityState={{ selected: selectedProjectId === MY_TASKS_PROJECT_ID }}
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
            style={[styles.badgeCount, { color: theme.colors.textSecondary }]}
          >
            {myActiveCount}
          </Text>
        </TouchableOpacity>

        {/* Individual Lists with Tree Hierarchy */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionHeaderTitle, { color: theme.colors.textSecondary }]}>
            MY LISTS
          </Text>
          <Text style={[styles.sectionHeaderHint, { color: theme.colors.textSecondary }]}>
            (Tap ⋯ or long-press to edit)
          </Text>
        </View>

        {flattenedActiveTree.map((node) => {
          const proj = node.project;
          const isSelected = proj.id === selectedProjectId;
          const activeTasks = projectActiveCounts.get(proj.id) || 0;
          const indentPadding = Math.min(node.depth * 14, 42);
          const dotColor = normalizeHexColor(proj.hex_color ?? undefined, true) || '#007AFF';

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
                onLongPress={() => {
                  safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
                  openExclusiveSubModal('actionSheet', proj.id);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
              >
                <View
                  style={[
                    styles.colorDot,
                    { backgroundColor: dotColor },
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
                    style={[styles.badgeCount, { color: theme.colors.textSecondary }]}
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
                  openExclusiveSubModal('actionSheet', proj.id);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`Options for ${proj.title}`}
              >
                <Text style={[styles.optionsBtnText, { color: theme.colors.textSecondary }]}>⋯</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        {/* Collapsible Archived Lists Section */}
        {archivedProjects.length > 0 && (
          <View style={styles.archivedSection}>
            <TouchableOpacity
              testID="drawer-archived-toggle"
              style={styles.archivedHeaderRow}
              onPress={() => {
                safeHaptics.selection();
                setShowArchived((prev) => !prev);
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ expanded: showArchived }}
              accessibilityLabel={`Archived lists (${archivedProjects.length})`}
            >
              <Text style={[styles.sectionHeaderTitle, { color: theme.colors.textSecondary }]}>
                ARCHIVED LISTS ({archivedProjects.length})
              </Text>
              <Text style={[styles.archivedChevron, { color: theme.colors.textSecondary }]}>
                {showArchived ? '▾' : '▸'}
              </Text>
            </TouchableOpacity>

            {showArchived &&
              archivedProjects.map((proj) => {
                const isSelected = proj.id === selectedProjectId;
                const dotColor = normalizeHexColor(proj.hex_color ?? undefined, true) || '#8E8E93';
                return (
                  <View
                    key={proj.id}
                    style={[
                      styles.projectItemWrapper,
                      styles.archivedItemWrapper,
                      isSelected && {
                        backgroundColor: theme.isDark ? '#2C2C2E' : '#E5E5EA',
                      },
                    ]}
                  >
                    <TouchableOpacity
                      testID={`drawer-project-${proj.id}`}
                      style={styles.projectItem}
                      onPress={() => handleSelect(proj.id)}
                      onLongPress={() => {
                        safeHaptics.impact(Haptics.ImpactFeedbackStyle.Medium);
                        openExclusiveSubModal('actionSheet', proj.id);
                      }}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                    >
                      <View style={[styles.colorDot, { backgroundColor: dotColor }]} />
                      <Text
                        style={[
                          styles.projectTitle,
                          { color: theme.colors.textSecondary },
                          isSelected && styles.projectTitleSelected,
                        ]}
                        numberOfLines={1}
                      >
                        📦 {proj.title}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      testID={`drawer-unarchive-${proj.id}`}
                      style={[
                        styles.unarchivePill,
                        { borderColor: theme.colors.border },
                      ]}
                      onPress={() => {
                        safeHaptics.selection();
                        archiveProject(proj.id, false).catch(() => {});
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Unarchive ${proj.title}`}
                    >
                      <Text style={[styles.unarchivePillText, { color: theme.colors.accent }]}>
                        Unarchive
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      testID={`drawer-project-options-${proj.id}`}
                      style={styles.optionsBtn}
                      onPress={() => {
                        safeHaptics.selection();
                        openExclusiveSubModal('actionSheet', proj.id);
                      }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Options for ${proj.title}`}
                    >
                      <Text style={[styles.optionsBtnText, { color: theme.colors.textSecondary }]}>
                        ⋯
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
          </View>
        )}
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
            openExclusiveSubModal('editor', null);
          }
        }}
        activeOpacity={0.7}
        accessibilityRole="button"
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
            openExclusiveSubModal('settings');
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={styles.settingsIcon}>⚙️</Text>
          <Text style={[styles.settingsText, { color: theme.colors.text }]}>Settings</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  ) : null;

  // Root-level sibling modals — NEVER nested inside ProjectDrawer's <Modal>!
  const sharedModals = (
    <>
      <SettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        onLogout={onLogout}
        onOpenLabelManagement={() => openExclusiveSubModal('labels')}
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
          setEditorProjectId(null);
        }}
      />

      <ProjectSharingModal
        visible={Boolean(sharingProject)}
        project={sharingProject}
        onClose={() => setSharingProjectId(null)}
      />

      {/* Project Options Action Sheet */}
      {actionSheetProject && (
        <Modal
          visible={Boolean(actionSheetProject)}
          transparent
          animationType="fade"
          onRequestClose={() => setActionSheetProjectId(null)}
        >
          <TouchableWithoutFeedback onPress={() => setActionSheetProjectId(null)}>
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
                      const pid = actionSheetProject.id;
                      openExclusiveSubModal('editor', pid);
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
                      const pid = actionSheetProject.id;
                      openExclusiveSubModal('sharing', pid);
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
                      toggleProjectFavorite(actionSheetProject.id).catch(() => {});
                      setActionSheetProjectId(null);
                    }}
                  >
                    <Text style={[styles.actionSheetOptionText, { color: theme.colors.text }]}>
                      {actionSheetProject.is_favorite ? '⭐ Remove Favorite' : '☆ Mark as Favorite'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    testID="drawer-option-archive"
                    style={[styles.actionSheetOption, { borderBottomColor: theme.colors.border }]}
                    onPress={() => {
                      archiveProject(
                        actionSheetProject.id,
                        !actionSheetProject.is_archived
                      ).catch(() => {});
                      setActionSheetProjectId(null);
                    }}
                  >
                    <Text style={[styles.actionSheetOptionText, { color: theme.colors.text }]}>
                      {actionSheetProject.is_archived ? '📂 Unarchive List' : '📦 Archive List'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionSheetCancel}
                    onPress={() => setActionSheetProjectId(null)}
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
    <>
      <Modal
        visible={visible && !hasActiveSubModal}
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
      </Modal>
      {sharedModals}
    </>
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
    borderRightWidth: 1,
    display: 'flex',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
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
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    fontSize: 18,
    fontWeight: '600',
  },
  projectList: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  projectItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
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
    fontWeight: '500',
  },
  projectTitleSelected: {
    fontWeight: '700',
  },
  badgeCount: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 6,
  },
  addListBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
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
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
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
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sectionHeaderTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionHeaderHint: {
    fontSize: 11,
    fontWeight: '500',
  },
  projectItemWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    marginBottom: 4,
  },
  archivedSection: {
    marginTop: 12,
    paddingBottom: 12,
  },
  archivedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  archivedChevron: {
    fontSize: 14,
    fontWeight: '700',
  },
  archivedItemWrapper: {
    opacity: 0.85,
  },
  unarchivePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    marginRight: 2,
  },
  unarchivePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  optionsBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  optionsBtnText: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 20,
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
