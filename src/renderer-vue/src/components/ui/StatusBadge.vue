<template>
  <span
    class="inline-block py-0.5 px-2 rounded-full text-[10px] font-medium"
    :class="classes"
  >{{ label }}</span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  status: { type: String, default: 'idle' },
})

const map = {
  syncing:  { label: 'Syncing',  classes: 'bg-blue-50 text-blue-700' },
  synced:   { label: 'Synced',   classes: 'bg-green-50 text-green-700' },
  error:    { label: 'Error',    classes: 'bg-red-50 text-red-700' },
  pending:  { label: 'Pending',  classes: 'bg-orange-50 text-orange-700' },
  paused:   { label: 'Paused',   classes: 'bg-gray-100 text-gray-500' },
  idle:     { label: 'Idle',     classes: 'bg-gray-50 text-gray-500' },
  active:   { label: 'Active',   classes: 'bg-blue-50 text-blue-700' },
  disabled: { label: 'Disabled', classes: 'bg-gray-100 text-gray-400' },
}

const entry = computed(() => map[props.status] || map.idle)
const label = computed(() => entry.value.label)
const classes = computed(() => entry.value.classes)
</script>
