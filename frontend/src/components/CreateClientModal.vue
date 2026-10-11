<template>
  <BaseModal @close="onClose">
    <template #title>
      <h3 class="title">{{ createdToken ? t('clients.createdTitle') : t('clients.createTitle') }}</h3>
    </template>
    <form v-if="!createdToken" @submit.prevent="onSubmit" class="form">
      <label class="field">
        <span>{{ t('clients.name') }}</span>
        <input v-model.trim="name" type="text" required :placeholder="t('clients.placeholder.name')" />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
    <div v-else class="token-reveal">
      <p class="token-label">{{ t('clients.tokenLabel') }}</p>
      <div class="token-value">
        <code>{{ createdToken }}</code>
        <button type="button" class="btn copy" @click="copyCreatedToken">{{ copied ? t('clients.tokenCopied') : t('clients.copyToken') }}</button>
      </div>
      <p class="token-hint">{{ t('clients.tokenHint') }}</p>
    </div>
    <template #footer>
      <template v-if="!createdToken">
        <button class="btn" @click="onClose" :disabled="submitting">{{ t('common.cancel') }}</button>
        <button class="btn primary" @click="onSubmit" :disabled="submitting || !name">{{ submitting ? t('clients.creating') : t('common.create') }}</button>
      </template>
      <button v-else class="btn primary" @click="onClose">{{ t('clients.done') }}</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from './BaseModal.vue'
import { clientApi } from '@/services/api'

const { t } = useI18n()

const emit = defineEmits<{ (e: 'close'): void; (e: 'created'): void }>()

const name = ref('')
const submitting = ref(false)
const error = ref('')

const createdToken = ref('')
const copied = ref(false)

const onClose = () => emit('close')

const copyCreatedToken = async () => {
  try {
    await navigator.clipboard.writeText(createdToken.value)
    copied.value = true
  } catch {
    copied.value = false
  }
}

const onSubmit = async () => {
  error.value = ''
  if (!name.value) {
    error.value = t('clients.nameRequired')
    return
  }
  submitting.value = true
  try {
    const res = await clientApi.createClient({ name: name.value })
    emit('created')

    if (res.data.token) {
      createdToken.value = res.data.token
    } else {
      emit('close')
    }
  } catch (e: any) {
    error.value = e?.errorDescription || t('clients.createError')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.title { margin: 0; font-size: 1.125rem; font-weight: 600; }
.form { display: flex; flex-direction: column; gap: 0.75rem; }
.field { display: flex; flex-direction: column; gap: 0.375rem; }
.field span { color: #374151; font-size: 0.875rem; }
input { border: 1px solid #e5e7eb; border-radius: 0.375rem; padding: 0.5rem; font-size: 0.875rem; }
.error { color: #b91c1c; font-size: 0.875rem; }
.btn { padding: 0.5rem 1rem; border: none; border-radius: 0.375rem; cursor: pointer; background: #e5e7eb; }
.btn.primary { background: #10b981; color: white; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.token-reveal { display: flex; flex-direction: column; gap: 0.5rem; }
.token-label { margin: 0; color: var(--color-text-secondary); font-size: 0.875rem; }
.token-value { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.token-value code {
  flex: 1;
  min-width: 12rem;
  word-break: break-all;
  background: var(--color-bg-hover);
  padding: 0.5rem;
  border-radius: 0.375rem;
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  color: var(--color-text-primary);
}
.btn.copy { background: #6366f1; color: var(--color-text-inverse); }
.token-hint { margin: 0; color: var(--color-warning); font-size: 0.8rem; }
</style>
