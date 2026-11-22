import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';
import { Project } from '../types/vikunja';
import { useAppTheme } from '../utils/theme';
import { safeHaptics } from '../utils/haptics';
import { normalizeHexColor } from '../utils/colors';

interface MoveListModalProps {
  visible: boolean;
  currentProjectId?: number | null;
  projects: Project[];
  onSelectProject: (projectId: number) => void;
  onClose: () => void;
}

export const MoveListModal: React.FC<MoveListModalProps> = ({
  visible,
  currentProjectId,
  projects,
  onSelectProject,
  onClose,
}) => {
  const theme = useAppTheme();

  const sortedProjects = React.useMemo(() => {
    const safeList = Array.isArray(projects) ? projects : [];
    return safeList
      .filter((p) => p.id > 0 && (!p.is_archived || p.id === currentProjectId))
      .sort((a, b) =>
        (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
      );
  }, [projects, currentProjectId]);

  const handleSelect = (projectId: number) => {
    safeHaptics.selection();
    onSelectProject(projectId);
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: theme.colors.card,
                  borderColor: theme.colors.cardBorder,
                },
              ]}
            >
              <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
                <Text style={[styles.title, { color: theme.colors.text }]}>Move to List</Text>
                <TouchableOpacity
                  testID="move-modal-close"
                  style={styles.closeBtn}
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close move to list dialog"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[styles.closeBtnText, { color: theme.colors.textSecondary }]}>✕</Text>
                </TouchableOpacity>
              </View>

              {sortedProjects.length === 0 ? (
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                  No active lists available
                </Text>
              ) : (
                <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
                  {sortedProjects.map((proj) => {
                    const isCurrent = proj.id === currentProjectId;
                    const dotColor =
                      normalizeHexColor(proj.hex_color ?? undefined, true) || theme.colors.accent;
                    return (
                      <TouchableOpacity
                        key={proj.id}
                        testID={`move-project-option-${proj.id}`}
                        style={[
                          styles.projectRow,
                          isCurrent && {
                            backgroundColor: theme.colors.surfaceSecondary,
                          },
                        ]}
                        onPress={() => handleSelect(proj.id)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isCurrent }}
                        accessibilityLabel={`Move to ${proj.title}${isCurrent ? ', current list' : ''}`}
                      >
                        <View
                          testID={`move-project-dot-${proj.id}`}
                          style={[
                            styles.colorDot,
                            { backgroundColor: dotColor },
                          ]}
                        />
                        <Text
                          style={[
                            styles.projectTitle,
                            { color: theme.colors.text },
                            isCurrent && {
                              color: theme.colors.accent,
                              fontWeight: '600',
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {proj.title}
                        </Text>
                        {isCurrent ? (
                          <Text style={[styles.currentBadge, { color: theme.colors.textSecondary }]}>
                            Current
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 32,
    paddingHorizontal: 20,
    maxHeight: '70%',
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
  list: {
    marginBottom: 8,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 4,
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
  currentBadge: {
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 8,
  },
});
