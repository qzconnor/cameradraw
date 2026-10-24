<script setup lang="ts">
import {
  CameraIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SunMediumIcon
} from '@lucide/vue'
import SidePanel from '@/components/common/SidePanel.vue'
import McpSettings from '@/components/mcp/McpSettings.vue'
import { FieldGroup } from '@/components/ui/field'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePanelsStore } from '@/stores/panels'
import CameraSettings from './CameraSettings.vue'
import GeneralSettings from './GeneralSettings.vue'
import PictureSettings from './PictureSettings.vue'

/** The settings, in tabs: general, camera, the camera's picture and the AI control (MCP). */
const panels = usePanelsStore()
</script>

<template>
  <SidePanel name="settings">
    <SheetHeader class="h-13 flex-row items-center gap-2 border-b py-0 pr-12 pl-4">
      <SettingsIcon class="size-4 text-muted-foreground" />
      <SheetTitle>Einstellungen</SheetTitle>
      <SheetDescription class="sr-only">Änderungen werden sofort übernommen.</SheetDescription>
    </SheetHeader>

    <Tabs v-model="panels.settingsTab" class="min-h-0 flex-1 gap-0">
      <TabsList variant="line" class="h-11! w-full shrink-0 border-b px-3">
        <TabsTrigger value="general"><SlidersHorizontalIcon />Allgemein</TabsTrigger>
        <TabsTrigger value="camera"><CameraIcon />Kamera</TabsTrigger>
        <TabsTrigger value="picture"><SunMediumIcon />Bild</TabsTrigger>
        <TabsTrigger value="ai"><SparklesIcon />KI</TabsTrigger>
      </TabsList>

      <ScrollArea class="min-h-0 flex-1">
        <TabsContent value="general" class="p-4"><GeneralSettings /></TabsContent>
        <TabsContent value="camera" class="p-4"><CameraSettings /></TabsContent>
        <TabsContent value="picture" class="p-4"><PictureSettings /></TabsContent>
        <TabsContent value="ai" class="p-4">
          <FieldGroup><McpSettings /></FieldGroup>
        </TabsContent>
      </ScrollArea>
    </Tabs>
  </SidePanel>
</template>
