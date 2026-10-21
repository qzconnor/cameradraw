<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { useEditorStore } from '@/stores/editor'

const editor = useEditorStore()

const open = computed({
  get: () => editor.pendingAction !== null,
  set: (value) => {
    // Deferred: the dialog closes before the action button's click handler runs,
    // which would otherwise drop the pending action before it can be confirmed.
    if (!value) setTimeout(() => editor.cancelPending())
  }
})
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Änderungen verwerfen?</AlertDialogTitle>
        <AlertDialogDescription>
          Deine Zeichnung wurde noch nicht gespeichert. Wenn du fortfährst, gehen die Änderungen
          verloren.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Weiter bearbeiten</AlertDialogCancel>
        <AlertDialogAction variant="destructive" @click="editor.confirmPending()"
          >Verwerfen</AlertDialogAction
        >
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
