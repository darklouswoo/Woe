<template>
  <div class="modal-backdrop" @click="emitClose">
    <div class="modal-container" @click.stop>
      <div class="modal-header">
        <slot name="title" />
        <button class="close-btn" @click="emitClose">✕</button>
      </div>
      <div class="modal-body">
        <slot />
      </div>
      <div class="modal-footer">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineEmits } from 'vue'

const emit = defineEmits(['close'])
const emitClose = () => emit('close')
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-container {
  width: 100%;
  max-width: 520px;
  background: var(--color-bg-primary);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border-primary);
}

.modal-body {
  padding: 1rem 1.25rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  border-top: 1px solid var(--color-border-primary);
}

.close-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  color: var(--color-text-tertiary);
}

.close-btn:hover {
  color: var(--color-text-primary);
}
</style>
