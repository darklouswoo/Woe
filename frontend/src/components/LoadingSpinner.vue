<template>
  <div class="loading-spinner" :class="{ [`size-${size}`]: true, [`variant-${variant}`]: true }">
    <div class="spinner-circle" v-if="variant === 'circle'"></div>
    <div class="spinner-dots" v-else-if="variant === 'dots'">
      <div class="dot"></div>
      <div class="dot"></div>
      <div class="dot"></div>
    </div>
    <div class="spinner-pulse" v-else-if="variant === 'pulse'"></div>

    <div v-if="text" class="spinner-text">{{ text }}</div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  size?: 'small' | 'medium' | 'large'
  variant?: 'circle' | 'dots' | 'pulse'
  text?: string
}

withDefaults(defineProps<Props>(), {
  size: 'medium',
  variant: 'circle',
  text: ''
})
</script>

<style scoped>
.loading-spinner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

.size-small {
  --spinner-size: 20px;
}

.size-medium {
  --spinner-size: 32px;
}

.size-large {
  --spinner-size: 48px;
}


.spinner-circle {
  width: var(--spinner-size);
  height: var(--spinner-size);
  border: 3px solid var(--color-primary-light);
  border-radius: 50%;
  border-top-color: var(--color-primary);
  animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}


.spinner-dots {
  display: flex;
  gap: 0.25rem;
}

.dot {
  width: calc(var(--spinner-size) / 4);
  height: calc(var(--spinner-size) / 4);
  background-color: var(--color-primary);
  border-radius: 50%;
  animation: bounce 1.4s ease-in-out infinite both;
}

.dot:nth-child(1) { animation-delay: -0.32s; }
.dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes bounce {
  0%, 80%, 100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}


.spinner-pulse {
  width: var(--spinner-size);
  height: var(--spinner-size);
  background-color: var(--color-primary);
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0% {
    transform: scale(0);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 0;
  }
}

.spinner-text {
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
  text-align: center;
}
</style>