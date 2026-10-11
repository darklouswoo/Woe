<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <h1>{{ $t('login.title') }}</h1>
        <p>{{ $t('login.subtitle') }}</p>
      </div>

  <form @submit.prevent="handleLogin" class="login-form">
        <div class="form-group">
          <label for="username">{{ $t('common.username') }}</label>
          <input
            id="username"
            v-model="username"
            type="text"
            required
            :disabled="loading"
            :placeholder="$t('login.usernamePlaceholder')"
          />
        </div>

        <div class="form-group">
          <label for="password">{{ $t('common.password') }}</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            :disabled="loading"
            :placeholder="$t('login.passwordPlaceholder')"
          />
        </div>

        <div v-if="error" class="error-message">
          {{ error }}
        </div>

        <button type="submit" :disabled="loading" class="login-btn">
          {{ loading ? $t('login.loggingIn') : $t('common.login') }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const authStore = useAuthStore()
const { t } = useI18n()

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

const handleLogin = async () => {
  loading.value = true
  error.value = ''

  try {
    const success = await authStore.login(username.value, password.value)

    if (success) {
      router.push('/')
    } else {
      error.value = t('login.error.invalidCredentials')
    }
  } catch (err: any) {
    if (err?.responseData?.errorCode === 403) {
      error.value = t('login.error.systemNotInitialized')
    } else {
      error.value = t('login.error.loginFailed')
    }
    console.error('Login error:', err)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 1rem;
}

.login-card {
  background: var(--color-bg-primary);
  padding: 2rem;
  border-radius: 1rem;
  box-shadow: var(--shadow-lg);
  width: 100%;
  max-width: 400px;
}

.login-header {
  text-align: center;
  margin-bottom: 2rem;
}

.login-header h1 {
  color: var(--color-text-primary);
  font-size: 2.5rem;
  font-weight: bold;
  margin-bottom: 0.5rem;
}

.login-header p {
  color: var(--color-text-tertiary);
  font-size: 1rem;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  color: var(--color-text-secondary);
  font-weight: 500;
  font-size: 0.875rem;
}

.form-group input {
  padding: 0.75rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  font-size: 1rem;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}

.form-group input:disabled {
  background-color: var(--color-bg-tertiary);
  color: var(--color-text-tertiary);
}

.error-message {
  color: var(--color-error);
  font-size: 0.875rem;
  text-align: center;
  padding: 0.75rem;
  background-color: var(--color-error-bg);
  border: 1px solid var(--color-error);
  border-radius: 0.375rem;
}

.login-btn {
  padding: 0.75rem 1.5rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.login-btn:hover:not(:disabled) {
  background-color: var(--color-primary-hover);
}

.login-btn:disabled {
  background-color: var(--color-text-muted);
  cursor: not-allowed;
}

@media (max-width: 480px) {
  .login-card {
    padding: 1.5rem;
  }

  .login-header h1 {
    font-size: 2rem;
  }
}
</style>
