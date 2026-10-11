<template>
  <div class="layout">
    <nav class="navbar">
      <div class="nav-brand">
        <h1>Woe</h1>
      </div>
      <div class="nav-menu">
        <router-link to="/" class="nav-item" active-class="active">
          {{ $t('common.dashboard') }}
        </router-link>
        <router-link to="/messages" class="nav-item" active-class="active">
          {{ $t('common.messages') }}
        </router-link>
        <router-link to="/applications" class="nav-item" active-class="active">
          {{ $t('common.applications') }}
        </router-link>
        <router-link to="/clients" class="nav-item" active-class="active">
          {{ $t('common.clients') }}
        </router-link>
        <router-link to="/plugins" class="nav-item" active-class="active">
          {{ $t('common.plugins') }}
        </router-link>
        <router-link to="/users" class="nav-item" active-class="active" v-if="authStore.user?.admin">
          {{ $t('common.users') }}
        </router-link>
        <router-link to="/settings" class="nav-item" active-class="active">
          {{ $t('common.settings') }}
        </router-link>
      </div>
      <div class="nav-user">

        <div class="language-switcher">
          <button
            @click="toggleLanguage"
            class="lang-btn"
            :title="$t('common.switchLanguage')"
          >
            {{ currentLocale === 'zh-CN' ? 'EN' : '中文' }}
          </button>
        </div>


        <div class="theme-switcher">
          <button
            @click="toggleTheme"
            class="theme-btn"
            :title="themeModeLabel"
          >
            <svg v-if="themeMode === 'light'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="12" cy="12" r="4"/>
              <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41"/>
            </svg>
            <svg v-else-if="themeMode === 'dark'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <path d="M8 21h8m-4-4v4"/>
            </svg>
          </button>
        </div>

        <div class="user-profile" @click="showProfileModal = true" v-if="authStore.user">
          <UserAvatar :user="authStore.user" size="small" :clickable="true" />
          <span class="user-info">{{ authStore.user?.nickname || authStore.user?.name }}</span>
        </div>
        <button @click="logout" class="logout-btn">
          {{ $t('common.logout') }}
        </button>
      </div>
    </nav>
    <main class="main-content">
      <slot />
    </main>

    <EditProfileModal
      v-if="showProfileModal && authStore.user"
      :user="authStore.user"
      @close="showProfileModal = false"
      @updated="handleProfileUpdated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import UserAvatar from './UserAvatar.vue'
import EditProfileModal from './EditProfileModal.vue'

const authStore = useAuthStore()
const themeStore = useThemeStore()
const router = useRouter()
const { locale, t } = useI18n()

const showProfileModal = ref(false)

const currentLocale = computed(() => locale.value)


const themeMode = computed(() => themeStore.mode)
const themeModeLabel = computed(() => {
  if (themeMode.value === 'light') return t('common.themeLight')
  if (themeMode.value === 'dark') return t('common.themeDark')
  return t('common.themeAuto')
})

const logout = () => {

  void authStore.logout().then((result) => {
    if (result === 'not-confirmed') {


      console.warn('Logout: server revocation not confirmed; the credential may still be valid')
    } else if (result === 'already-unusable') {

      console.info('Logout: credential already rejected by server (revocation outcome unconfirmed)')
    }
  })
  router.push('/login')
}


const toggleLanguage = () => {
  const newLocale = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN'
  locale.value = newLocale
  localStorage.setItem('locale', newLocale)
}


const toggleTheme = () => {
  themeStore.toggleTheme()
}

const handleProfileUpdated = (user: any) => {
  authStore.user = user
}
</script>

<style scoped>
.layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  transition: var(--theme-transition);
}

.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2rem;
  height: 60px;
  background: var(--color-bg-primary);
  border-bottom: 1px solid var(--color-border-primary);
  box-shadow: var(--shadow-sm);
  transition: var(--theme-transition);
}

.nav-brand h1 {
  color: var(--color-text-primary);
  font-size: 1.5rem;
  font-weight: bold;
}

.nav-menu {
  display: flex;
  gap: 1rem;
}

.nav-item {
  padding: 0.5rem 1rem;
  color: var(--color-text-tertiary);
  text-decoration: none;
  border-radius: 0.375rem;
  transition: var(--theme-transition);
}

.nav-item:hover {
  color: var(--color-text-primary);
  background-color: var(--color-bg-hover);
}

.nav-item.active {
  color: var(--color-text-primary);
  background-color: var(--color-bg-active);
}

.nav-user {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-profile {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  transition: background-color 0.2s;
}

.user-profile:hover {
  background-color: var(--color-bg-hover);
}

.user-info {
  color: var(--color-text-tertiary);
  font-size: 0.875rem;
}

.logout-btn {
  padding: 0.5rem 1rem;
  background-color: var(--color-error);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.2s;
}

.logout-btn:hover {
  background-color: #dc2626;
}


.language-switcher,
.theme-switcher {
  display: flex;
  align-items: center;
}

.lang-btn,
.theme-btn {
  padding: 0.5rem;
  background-color: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-primary);
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--theme-transition);
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
}

.lang-btn:hover,
.theme-btn:hover {
  background-color: var(--color-bg-hover);
  border-color: var(--color-border-secondary);
}

.main-content {
  flex: 1;
  padding: 2rem;
  background-color: var(--color-bg-secondary);
  transition: var(--theme-transition);
}

@media (max-width: 768px) {
  .navbar {
    flex-direction: column;
    height: auto;
    padding: 1rem;
    gap: 1rem;
  }

  .nav-menu {
    flex-wrap: wrap;
    justify-content: center;
  }

  .language-switcher,
  .theme-switcher {
    order: -1;
  }

  .main-content {
    padding: 1rem;
  }
}
</style>