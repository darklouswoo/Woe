<template>
  <Layout>
    <div class="applications">
      <div class="page-header">
        <h1 class="page-title">{{ $t('common.applications') }}</h1>
        <button @click="showCreateModal = true" class="create-btn">{{ $t('applications.add') }}</button>
      </div>

      <div v-if="loading" class="loading">{{ $t('applications.loadingApplications') }}</div>

      <div v-else class="applications-grid">
        <div
          v-for="app in applications"
          :key="app.id"
          class="app-card"
        >
          <div class="app-clickable-area" @click="navigateToDetail(app.id)">
            <div class="app-header">
              <div class="app-icon-container" @click.stop>
                <ApplicationIcon
                  :name="app.name"
                  :image="app.image"
                  :show-upload-overlay="true"
                  :show-delete-button="true"
                  @upload="(file) => uploadIcon(app.id, file)"
                  @delete="() => deleteIcon(app.id)"
                />
              </div>
              <div class="app-title-container">
                <h3>{{ app.name }}</h3>
                <span class="app-priority" :class="`priority-${Math.min(app.defaultPriority ?? 0, 3)}`">
                  {{ $t('common.priority') }} {{ app.defaultPriority }}
                </span>
              </div>
            </div>
            <p class="app-description">{{ app.description || $t('applications.noDescription') }}</p>
            <div class="app-info">


              <p v-if="knownToken(app)" class="app-token">
                <strong>{{ $t('common.token') }}:</strong>
                <code>{{ maskToken(knownToken(app)!) }}</code>
              </p>
              <p class="app-last-ping">{{ $t('applications.lastPing') }}: {{ formatDate(app.lastUsed || '') || $t('common.never') }}</p>
            </div>
          </div>
          <div class="app-actions">
            <button v-if="knownToken(app)" @click="copyToken(knownToken(app)!)" class="copy-btn">{{ $t('applications.copyToken') }}</button>
            <button v-else @click="confirmRegenerateToken(app)" class="regenerate-btn">{{ $t('applications.regenerateToken') }}</button>
            <button @click="editApplication(app)" class="edit-btn">{{ $t('common.edit') }}</button>
            <button @click="deleteApplication(app.id)" class="delete-btn">{{ $t('common.delete') }}</button>
          </div>
        </div>
      </div>

      <div v-if="!loading && applications.length === 0" class="empty-state">
        {{ $t('applications.noApplications') }}
      </div>

      <CreateApplicationModal
        v-if="showCreateModal"
        @close="showCreateModal = false"
        @created="reloadApplications"
      />
      <EditApplicationModal
        v-if="showEditModal && editingApplication"
        :application="editingApplication"
        @close="showEditModal = false"
        @updated="reloadApplications"
      />
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Layout from '@/components/Layout.vue'
import ApplicationIcon from '@/components/ApplicationIcon.vue'
import CreateApplicationModal from '@/components/CreateApplicationModal.vue'
import EditApplicationModal from '@/components/EditApplicationModal.vue'
import { applicationApi } from '@/services/api'
import { authService } from '@/services/auth'
import { showSuccess, showError } from '@/utils/errorHandler'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { formatDate } from '@/utils/datetime'
import { useElevatedAction, isElevationCancelled } from '@/composables/useElevatedAction'
import type { Application } from '@/types'

const { t } = useI18n()
const router = useRouter()
const { confirm: confirmDialog } = useConfirmDialog()
const { withElevation } = useElevatedAction()

const applications = ref<Application[]>([])
const loading = ref(true)
const showCreateModal = ref(false)
const showEditModal = ref(false)
const editingApplication = ref<Application | null>(null)







const knownToken = (app: Application): string | null => {
  return authService.getAppToken(app.id)?.token || null
}

const maskToken = (token: string): string => {
  if (token.length <= 12) return token
  return `${token.substring(0, 8)}...${token.substring(token.length - 4)}`
}

const navigateToDetail = (appId: number) => {
  router.push(`/applications/${appId}`)
}

const loadApplications = async () => {
  try {
    const res = await applicationApi.getApplications()
    applications.value = res.data || []
  } catch (err) {
    console.error('Failed to load applications:', err)
  } finally {
    loading.value = false
  }
}

const reloadApplications = async () => {
  loading.value = true
  await loadApplications()
}

const copyToken = async (token: string) => {
  try {
    await navigator.clipboard.writeText(token)
    showSuccess(t('applications.tokenCopied'))
  } catch (err: any) {
    console.error('Failed to copy token:', err)
    showError(err, t('applications.copyTokenError'))
  }
}





const confirmRegenerateToken = async (app: Application) => {
  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('applicationDetail.regenerateWarning'),
    confirmText: t('common.confirmDialog.confirmButton'),
    cancelText: t('common.confirmDialog.cancelButton'),
    type: 'warning'
  })

  if (!confirmed) return

  try {

    const res = await withElevation(() => applicationApi.regenerateToken(app.id))
    const newToken = res.data.regenerateToken.token
    authService.setAppToken(app.id, newToken)

    applications.value = [...applications.value]
    showSuccess(t('applications.regenerated'))
  } catch (err: any) {
    if (!isElevationCancelled(err)) {
      showError(err, t('applications.regenerateFailed'))
    }
  }
}

const editApplication = (app: Application) => {
  editingApplication.value = app
  showEditModal.value = true
}

const deleteApplication = async (id: number) => {
  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('applications.deleteConfirm'),
    confirmText: t('common.confirmDialog.confirmButton'),
    cancelText: t('common.confirmDialog.cancelButton'),
    type: 'danger'
  })

  if (confirmed) {
    try {

      await withElevation(() => applicationApi.deleteApplication(id))
      authService.removeAppToken(id)
      showSuccess(t('applications.deleteSuccess'))
      await reloadApplications()
    } catch (err: any) {
      if (!isElevationCancelled(err)) {
        showError(err, t('applications.deleteError'))
      }
    }
  }
}

const uploadIcon = async (appId: number, file: File) => {
  try {
    await applicationApi.uploadApplicationImage(appId, file)
    showSuccess(t('applications.iconUploaded'))
    await reloadApplications()
  } catch (err: any) {
    showError(err, t('applications.uploadIconError'))
  }
}

const deleteIcon = async (appId: number) => {
  try {
    await applicationApi.deleteApplicationImage(appId)
    showSuccess(t('applications.iconDeleted'))
    await reloadApplications()
  } catch (err: any) {
    showError(err, t('applications.deleteIconError'))
  }
}

onMounted(() => {
  loadApplications()
})
</script>

<style scoped>
.applications {
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.page-title {
  font-size: 2rem;
  font-weight: bold;
  color: var(--color-text-primary);
  margin: 0;
}

.create-btn {
  padding: 0.5rem 1rem;
  background-color: var(--color-success);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: var(--theme-transition);
}

.create-btn:hover {
  background-color: var(--color-success-hover);
}

.loading, .empty-state {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 3rem;
  font-size: 1rem;
}

.applications-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 1.5rem;
}

.app-card {
  background: var(--color-bg-primary);
  padding: 1.5rem;
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  transition: var(--theme-transition);
}

.app-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.app-clickable-area {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  cursor: pointer;
  flex: 1;
}

.app-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.app-icon-container {
  flex-shrink: 0;
}

.app-title-container {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.app-title-container h3 {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.app-priority {
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.priority-0 { background: var(--color-info-bg); color: var(--color-info); }
.priority-1 { background: var(--color-bg-hover); color: var(--color-text-secondary); }
.priority-2 { background: #fef3c7; color: #92400e; }
.priority-3 { background: #fecaca; color: #991b1b; }

.app-description {
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0;
}

.app-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.app-token {
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
  margin: 0;
  word-break: break-all;
}

.app-token code {
  background: var(--color-bg-hover);
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
  font-family: 'Courier New', monospace;
  font-size: 0.8em;
}

.regenerate-btn {
  padding: 0.375rem 0.75rem;
  background-color: var(--color-warning);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--theme-transition);
}

.regenerate-btn:hover {
  background-color: var(--color-warning-hover);
}

.app-last-ping {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin: 0;
}

.app-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.copy-btn {
  padding: 0.375rem 0.75rem;
  background-color: #6366f1;
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--theme-transition);
}

.copy-btn:hover {
  background-color: #4f46e5;
}

.edit-btn {
  padding: 0.375rem 0.75rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--theme-transition);
}

.edit-btn:hover {
  background-color: var(--color-primary-hover);
}

.delete-btn {
  padding: 0.375rem 0.75rem;
  background-color: var(--color-error);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--theme-transition);
}

.delete-btn:hover {
  background-color: var(--color-error-hover);
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .applications-grid {
    grid-template-columns: 1fr;
  }

  .app-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .app-actions {
    justify-content: stretch;
  }

  .app-actions button {
    flex: 1;
  }
}
</style>
