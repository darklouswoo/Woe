<template>
  <Layout>
    <div class="application-detail">
      <div v-if="loading" class="loading-container">
        <LoadingSpinner :text="t('applicationDetail.loading')" />
      </div>

      <div v-else-if="error" class="error-container">
        <div class="error-message">
          <h3>{{ t('applicationDetail.errorTitle') }}</h3>
          <p>{{ error }}</p>
          <button @click="loadApplication" class="retry-btn">{{ t('applicationDetail.retry') }}</button>
        </div>
      </div>

      <div v-else-if="application" class="application-content">
        <div class="application-header">
          <div class="app-icon-large">
            <ApplicationIcon
              :name="application.name"
              :image="application.image"
              size="large"
              :show-upload-overlay="true"
              :show-delete-button="true"
              @upload="uploadIcon"
              @delete="deleteIcon"
            />
          </div>

          <div class="app-info">
            <h1 class="app-name">{{ application.name }}</h1>
            <p class="app-description">{{ application.description || t('applicationDetail.noDescription') }}</p>

            <div class="app-meta">
              <div class="meta-item">
                <span class="meta-label">{{ t('applicationDetail.appId') }}</span>
                <span class="meta-value">{{ application.id }}</span>
              </div>

              <div class="meta-item">
                <span class="meta-label">{{ t('applicationDetail.defaultPriority') }}</span>
                <span class="meta-value priority-badge" :class="`priority-${Math.min(application.defaultPriority ?? 0, 3)}`">
                  {{ getPriorityLabel(application.defaultPriority) }}
                </span>
              </div>

              <div class="meta-item">
                <span class="meta-label">{{ t('applicationDetail.lastUsed') }}</span>
                <span class="meta-value">{{ formatDate(application.lastUsed || '') || t('common.never') }}</span>
              </div>

              <div class="meta-item">
                <span class="meta-label">{{ t('applicationDetail.internal') }}</span>
                <span class="meta-value">{{ application.internal ? t('common.yes') : t('common.no') }}</span>
              </div>
            </div>

            <div class="app-actions">
              <button @click="showEditModal = true" class="edit-btn">{{ t('applicationDetail.editApplication') }}</button>
              <button v-if="knownToken" @click="copyToken" class="copy-btn">{{ t('applicationDetail.copyToken') }}</button>
              <button @click="confirmDelete" class="delete-btn">{{ t('applicationDetail.deleteApplication') }}</button>
            </div>
          </div>
        </div>

        <div class="application-sections">

          <div class="section">
            <h2 class="section-title">{{ t('applicationDetail.tokenTitle') }}</h2>
            <div class="token-container">
              <template v-if="knownToken">
                <div class="token-display">
                  <code :class="{ 'token-hidden': !tokenVisible }">
                    {{ tokenVisible ? knownToken : '•••••••••••••••••••••' }}
                  </code>
                  <button
                    @click="toggleTokenVisibility"
                    class="token-toggle-btn"
                    :title="tokenVisible ? t('applicationDetail.hideToken') : t('applicationDetail.showToken')"
                  >
                    <svg v-if="!tokenVisible" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8"></path>
                      <path d="M9.5 9a3 3 0 0 1 0 6"></path>
                    </svg>
                    <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 0 5.06 5.06M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 0-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                  </button>
                </div>
                <button @click="copyToken" class="token-copy-btn">
                  {{ t('applicationDetail.copyToken') }}
                </button>
              </template>
              <button @click="confirmRegenerateToken" class="regenerate-btn">
                {{ t('applicationDetail.regenerateToken') }}
              </button>
            </div>
            <p class="token-description">
              {{ knownToken ? t('applicationDetail.tokenDescription') : t('applicationDetail.tokenUnknownHint') }}
            </p>
          </div>


          <div class="section">
            <div class="section-header">
              <h2 class="section-title">{{ t('applicationDetail.recentMessages') }}</h2>
              <router-link :to="`/messages?appId=${application.id}`" class="view-all-btn">
                {{ t('applicationDetail.viewAllMessages') }}
              </router-link>
            </div>

            <div v-if="messagesLoading" class="loading-container">
              <LoadingSpinner :text="t('applicationDetail.loadingMessages')" />
            </div>

            <div v-else-if="messages.length === 0" class="empty-messages">
              <EmptyState
                type="messages"
                :title="t('applicationDetail.noMessagesTitle')"
                :description="t('applicationDetail.noMessagesDescription')"
                size="small"
              />
            </div>

            <div v-else class="messages-list">
              <div v-for="message in messages" :key="message.id" class="message-item">
                <div class="message-header">
                  <h4 class="message-title">{{ message.title || t('applicationDetail.noTitle') }}</h4>
                  <span class="message-time" :title="formatDateTime(message.date)">{{ formatRelativeTime(message.date) }}</span>
                </div>
                <p class="message-content">{{ message.message }}</p>
                <div class="message-priority" :class="`priority-${Math.min(message.priority ?? 1, 3)}`">
                  {{ getPriorityLabel(message.priority) }}
                </div>
              </div>

              <div v-if="hasMoreMessages" class="load-more-container">
                <button
                  @click="loadMoreMessages"
                  :disabled="loadingMoreMessages"
                  class="load-more-btn"
                >
                  <LoadingSpinner v-if="loadingMoreMessages" size="small" variant="dots" />
                  <span v-else>{{ t('applicationDetail.loadMore') }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>


      <EditApplicationModal
        v-if="showEditModal && application"
        :application="application"
        @close="showEditModal = false"
        @updated="handleApplicationUpdated"
      />
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Layout from '@/components/Layout.vue'
import ApplicationIcon from '@/components/ApplicationIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import EditApplicationModal from '@/components/EditApplicationModal.vue'
import { applicationApi } from '@/services/api'
import { authService } from '@/services/auth'
import { showSuccess, showError } from '@/utils/errorHandler'
import { formatRelativeTime, formatDateTime, formatDate } from '@/utils/datetime'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useElevatedAction, isElevationCancelled } from '@/composables/useElevatedAction'
import type { Application, Message, Paging } from '@/types'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { confirm: confirmDialog } = useConfirmDialog()
const { withElevation } = useElevatedAction()

const application = ref<Application | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const tokenVisible = ref(false)

const knownToken = ref('')
const showEditModal = ref(false)


const messages = ref<Message[]>([])
const messagesLoading = ref(false)
const loadingMoreMessages = ref(false)
const hasMoreMessages = ref(false)
const messagePaging = ref<Paging>({
  size: 0,
  since: 0,
  limit: 20
})

const appId = computed(() => {
  return Number(route.params.id)
})








const getPriorityLabel = (priority?: number) => {
  if (priority === undefined || priority === null) return t('common.priorityNormal')
  const labels = [t('common.priorityLow'), t('common.priorityNormal'), t('common.priorityHigh'), t('common.priorityEmergency')]
  return labels[Math.min(priority, 3)] || t('common.priorityNormal')
}




const loadApplication = async () => {
  loading.value = true
  error.value = null

  try {
    const response = await applicationApi.getApplication(appId.value)
    application.value = response.data

    knownToken.value = authService.getAppToken(appId.value)?.token || ''

    loadMessages()
  } catch (err: any) {
    error.value = err.errorDescription || t('applicationDetail.loadError')
    showError(err, t('applicationDetail.loadError'))
  } finally {
    loading.value = false
  }
}




const loadMessages = async () => {
  messagesLoading.value = true

  try {
    const response = await applicationApi.getApplicationMessages(appId.value, { limit: 20 })


    messages.value = response.data.messages
    messagePaging.value = response.data.paging
    hasMoreMessages.value = !!response.data.paging.next
  } catch (err: any) {
    showError(err, t('applicationDetail.loadMessagesError'))
  } finally {
    messagesLoading.value = false
  }
}




const loadMoreMessages = async () => {
  if (!hasMoreMessages.value || loadingMoreMessages.value) return

  loadingMoreMessages.value = true

  try {
    const params = {
      limit: messagePaging.value.limit,
      since: messagePaging.value.since
    }
    const response = await applicationApi.getApplicationMessages(appId.value, params)


    const olderMessages = response.data.messages
    messages.value = [...messages.value, ...olderMessages]

    messagePaging.value = response.data.paging
    hasMoreMessages.value = !!response.data.paging.next
  } catch (err: any) {
    showError(err, t('applicationDetail.loadMoreMessagesError'))
  } finally {
    loadingMoreMessages.value = false
  }
}

const toggleTokenVisibility = () => {
  tokenVisible.value = !tokenVisible.value
}




const copyToken = async () => {
  if (!knownToken.value) return

  try {
    await navigator.clipboard.writeText(knownToken.value)
    showSuccess(t('applications.tokenCopied'))
  } catch (err) {
    showError(err as Error, t('applications.copyTokenError'))
  }
}




const confirmRegenerateToken = async () => {
  if (!application.value) return

  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('applicationDetail.regenerateWarning'),
    confirmText: t('common.confirmDialog.confirmButton'),
    cancelText: t('common.confirmDialog.cancelButton'),
    type: 'warning'
  })

  if (confirmed) {
    regenerateToken()
  }
}




const regenerateToken = async () => {
  if (!application.value) return
  const id = application.value.id

  try {

    const res = await withElevation(() => applicationApi.regenerateToken(id))
    const newToken = res.data.regenerateToken.token

    authService.setAppToken(id, newToken)
    knownToken.value = newToken
    tokenVisible.value = true
    showSuccess(t('applicationDetail.regenerated'))
  } catch (err: any) {
    if (!isElevationCancelled(err)) {
      showError(err, t('applicationDetail.regenerateFailed'))
    }
  }
}





const uploadIcon = async (file: File) => {
  if (!application.value) return

  try {
    await applicationApi.uploadApplicationImage(application.value.id, file)
    showSuccess(t('applications.iconUploaded'))

    await loadApplication()
  } catch (err: any) {
    showError(err, t('applications.uploadIconError'))
  }
}




const deleteIcon = async () => {
  if (!application.value) return

  try {
    await applicationApi.deleteApplicationImage(application.value.id)
    showSuccess(t('applications.iconDeleted'))

    await loadApplication()
  } catch (err: any) {
    showError(err, t('applications.deleteIconError'))
  }
}

const handleApplicationUpdated = () => {
  showEditModal.value = false
  loadApplication()
}

const confirmDelete = async () => {
  if (!application.value) return

  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('applications.deleteConfirmWithName', { name: application.value.name }),
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
    type: 'danger'
  })

  if (confirmed) {
    deleteApplication()
  }
}




const deleteApplication = async () => {
  if (!application.value) return
  const id = application.value.id

  try {

    await withElevation(() => applicationApi.deleteApplication(id))
    authService.removeAppToken(id)
    showSuccess(t('applications.deleteSuccess'))
    router.push('/applications')
  } catch (err: any) {
    if (!isElevationCancelled(err)) {
      showError(err, t('applications.deleteError'))
    }
  }
}

onMounted(() => {
  loadApplication()
})
</script>

<style scoped>
.application-detail {
  max-width: 1000px;
  margin: 0 auto;
}

.loading-container {
  display: flex;
  justify-content: center;
  padding: 3rem;
}

.error-container {
  padding: 2rem;
}

.error-message {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 0.5rem;
  padding: 1.5rem;
  text-align: center;
  max-width: 500px;
  margin: 0 auto;
}

.error-message h3 {
  color: #b91c1c;
  margin-bottom: 0.5rem;
}

.error-message p {
  color: #991b1b;
  margin-bottom: 1rem;
}

.retry-btn {
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  padding: 0.5rem 1rem;
  cursor: pointer;
}

.application-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.application-header {
  display: flex;
  gap: 2rem;
  padding: 1.5rem;
  background: var(--color-bg-primary);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm);
}

.app-icon-large {
  flex-shrink: 0;
}

.app-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.app-name {
  font-size: 1.875rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
}

.app-description {
  color: var(--color-text-tertiary);
  font-size: 1rem;
  line-height: 1.5;
}

.app-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 150px;
}

.meta-label {
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
  font-weight: 500;
}

.meta-value {
  font-size: 0.875rem;
  color: var(--color-text-primary);
  font-weight: 600;
}

.priority-badge {
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.priority-0 { background: var(--color-info-bg); color: var(--color-info); }
.priority-1 { background: var(--color-bg-hover); color: var(--color-text-secondary); }
.priority-2 { background: #fef3c7; color: #92400e; }
.priority-3 { background: #fecaca; color: #991b1b; }

.app-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.edit-btn, .copy-btn, .delete-btn, .regenerate-btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: var(--theme-transition);
}

.regenerate-btn {
  margin-left: 0.5rem;
  white-space: nowrap;
  background-color: var(--color-warning);
  color: var(--color-text-inverse);
}

.regenerate-btn:hover {
  background-color: var(--color-warning-hover);
}

.edit-btn {
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
}

.edit-btn:hover {
  background-color: var(--color-primary-hover);
}

.copy-btn {
  background-color: #6366f1;
  color: var(--color-text-inverse);
}

.copy-btn:hover {
  background-color: #4f46e5;
}

.delete-btn {
  background-color: var(--color-error);
  color: var(--color-text-inverse);
}

.delete-btn:hover {
  background-color: var(--color-error-hover);
}

.application-sections {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.section {
  background: var(--color-bg-primary);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem 1.5rem 0;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
  padding: 0 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border-primary);
}


.section > .section-title {
  padding-top: 1.5rem;
}

.view-all-btn {
  color: var(--color-primary);
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  transition: var(--theme-transition);
}

.view-all-btn:hover {
  background-color: #f0f9ff;
}

.token-container {
  padding: 1.5rem;
}

.token-display {
  display: flex;
  align-items: center;
  background: var(--color-bg-hover);
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.5rem;
  padding: 0.75rem;
  margin-bottom: 1rem;
}

.token-display code {
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  color: var(--color-text-primary);
  background: transparent;
  flex: 1;
  word-break: break-all;
}

.token-hidden {
  letter-spacing: 2px;
}

.token-copy-btn {
  margin-left: 0.5rem;
  white-space: nowrap;
  background-color: #6366f1;
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  padding: 0.5rem 1rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: var(--theme-transition);
}

.token-copy-btn:hover {
  background-color: #4f46e5;
}

.token-toggle-btn {
  background: none;
  border: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 0.25rem;
  margin-left: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.token-toggle-btn:hover {
  background-color: var(--color-border-secondary);
}

.token-description {
  color: var(--color-text-tertiary);
  font-size: 0.875rem;
  margin: 0;

  padding: 0 1.5rem 1.5rem;
}

.messages-list {
  padding: 0 1.5rem 1.5rem;
}

.message-item {
  padding: 1rem;
  border: 1px solid var(--color-border-primary);
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.message-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.message-time {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

.message-content {
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
  margin-bottom: 0.5rem;
}

.message-priority {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.empty-messages {
  padding: 2rem 1.5rem;
}

.load-more-container {
  display: flex;
  justify-content: center;
  padding: 1rem 1.5rem;
}

.load-more-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1.5rem;
  background-color: var(--color-bg-hover);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--theme-transition);
}

.load-more-btn:hover:not(:disabled) {
  background-color: var(--color-bg-active);
}

.load-more-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}


@media (max-width: 768px) {
  .application-header {
    flex-direction: column;
    gap: 1rem;
  }

  .app-meta {
    flex-direction: column;
    gap: 0.75rem;
  }

  .meta-item {
    min-width: auto;
  }

  .app-actions {
    justify-content: stretch;
  }

  .app-actions button {
    flex: 1;
  }

  .section-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
}
</style>
