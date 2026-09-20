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
import * as Haptics from 'expo-haptics';
import { Project } from '../types/vikunja';

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
  const handleSelect = (projectId: number) => {
    try {
      Haptics.selectionAsync?.();
    } catch (_) {}
    onSelectProject(projectId);
    onClose();
  };

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
            <View style={styles.sheet}>
              <View style={styles.header}>
                <Text style={styles.title}>Move to List</Text>
                <TouchableOpacity
                  testID="move-modal-close"
                  style={styles.closeBtn}
                  onPress={onClose}
                >
                  <Text style={styles.closeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.list}>
                {projects.map((proj) => {
                  const isCurrent = proj.id === currentProjectId;
                  return (
                    <TouchableOpacity
                      key={proj.id}
                      testID={`move-project-option-${proj.id}`}
                      style={[styles.projectRow, isCurrent && styles.projectRowCurrent]}
                      onPress={() => handleSelect(proj.id)}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.colorDot,
                          { backgroundColor: proj.hex_color || '#007AFF' },
                        ]}
                      />
                      <Text
                        style={[
                          styles.projectTitle,
                          isCurrent && styles.projectTitleCurrent,
                        ]}
                      >
                        {proj.title}
                      </Text>
                      {isCurrent ? <Text style={styles.currentBadge}>Current</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
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
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 32,
    paddingHorizontal: 20,
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2C2C2E',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    color: '#8E8E93',
    fontSize: 16,
    fontWeight: '600',
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
  projectRowCurrent: {
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
    color: '#F2F2F7',
    fontWeight: '500',
  },
  projectTitleCurrent: {
    color: '#30D158',
    fontWeight: '600',
  },
  currentBadge: {
    fontSize: 12,
    color: '#8E8E93',
    fontWeight: '500',
  },
});
