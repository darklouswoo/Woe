import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'

const router = createRouter({



  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/Login.vue'),
      meta: { requiresAuth: false }
    },
    {
      path: '/',
      name: 'Dashboard',
      component: () => import('@/views/Dashboard.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/setup',
      name: 'Setup',
      component: () => import('@/views/Setup.vue'),
      meta: { requiresAuth: false }
    },
    {
      path: '/messages',
      name: 'Messages',
      component: () => import('@/views/Messages.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/applications',
      name: 'Applications',
      component: () => import('@/views/Applications.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/applications/:id',
      name: 'ApplicationDetail',
      component: () => import('@/views/ApplicationDetail.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/clients',
      name: 'Clients',
      component: () => import('@/views/Clients.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/users',
      name: 'Users',
      component: () => import('@/views/Users.vue'),
      meta: { requiresAuth: true, requiresAdmin: true }
    },
    {
      path: '/plugins',
      name: 'Plugins',
      component: () => import('@/views/Plugins.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/plugins/:id',
      name: 'PluginDetail',
      component: () => import('@/views/PluginDetail.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/settings',
      name: 'Settings',
      component: () => import('@/views/Settings.vue'),
      meta: { requiresAuth: true }
    },
    {

      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('@/views/NotFound.vue'),
      meta: { requiresAuth: false }
    }
  ]
})

router.beforeEach(async (to, _, next) => {
  const authStore = useAuthStore()
  try {
    const statusRes = await api.get('/init/status')
    const status = statusRes.data as { initialized: boolean; hasAdmin: boolean; canInitialize?: boolean }
    const canInitialize = typeof status.canInitialize === 'boolean'
      ? status.canInitialize
      : (!status.initialized || !status.hasAdmin)

    if (canInitialize && to.path !== '/setup') {
      return next('/setup')
    }

    if (!canInitialize && to.path === '/setup') {
      return next(authStore.isAuthenticated ? '/' : '/login')
    }
  } catch {}

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next('/login')
  } else if (to.path === '/login' && authStore.isAuthenticated) {
    next('/')
  } else if (to.meta.requiresAdmin && authStore.isAuthenticated) {


    if (!authStore.user) {
      await authStore.checkAuth()
    }
    if (!authStore.user?.admin) {
      next('/')
    } else {
      next()
    }
  } else {
    next()
  }
})

export default router
