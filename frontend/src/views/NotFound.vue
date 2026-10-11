<template>
  <div class="not-found-page">
    <EmptyState type="error" :title="$t('notFound.title')" :description="$t('notFound.description')">
      <template #actions>
        <router-link to="/" class="back-btn">{{ $t('notFound.backToDashboard') }}</router-link>
      </template>
    </EmptyState>
  </div>
</template>

<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
</script>

<style scoped>
.not-found-page {
  min-height: 60vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.back-btn {
  padding: 0.5rem 1.25rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 500;
  transition: background-color 0.2s;
}

.back-btn:hover {
  background-color: var(--color-primary-hover);
}
</style>
