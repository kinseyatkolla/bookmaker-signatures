<script setup>
import { toRefs } from "vue";

const props = defineProps({
  state: { type: Object, required: true },
  handlers: { type: Object, required: true },
});

const { state, handlers } = toRefs(props);
</script>

<template>
  <div class="actions">
    <button
      type="button"
      class="primary-button"
      :disabled="state.isGeneratingPdf"
      @click="handlers.generatePdfOutput()"
    >
      {{ state.isGeneratingPdf ? "Generating..." : "Generate PDF Output" }}
    </button>
    <small v-if="state.pdfError" class="error-text">{{ state.pdfError }}</small>
  </div>

  <div
    v-if="state.rasterizeProgressActive || state.rasterizeProgressTotal > 0"
    class="raster-progress"
    role="status"
    aria-live="polite"
  >
    <p class="raster-progress-label">
      Rasterizing DOM pages: {{ state.rasterizeProgressCurrent }} /
      {{ state.rasterizeProgressTotal }}
      <span v-if="state.rasterizeProgressTotal > 0">
        ({{ state.rasterizeProgressPercent }}%)
      </span>
    </p>
    <progress
      class="raster-progress-bar"
      :max="state.rasterizeProgressTotal || 1"
      :value="state.rasterizeProgressCurrent"
    />
  </div>

  <div v-if="state.combinedPdfUrl" class="download-group">
    <button
      type="button"
      class="small-button"
      @click="handlers.downloadCombinedPdf()"
    >
      Download PDF ({{ state.combinedPdfPageCount }} page{{
        state.combinedPdfPageCount === 1 ? "" : "s"
      }})
    </button>
  </div>

  <div v-if="state.combinedPdfUrl" class="pdf-preview-single">
    <section class="pdf-pane pdf-pane-wide">
      <h4>Combined PDF preview</h4>
      <iframe :src="state.combinedPdfUrl" title="Combined PDF Preview"></iframe>
    </section>
  </div>
</template>

<style scoped>
.raster-progress {
  margin-top: 0.75rem;
}

.raster-progress-label {
  margin: 0 0 0.35rem;
  font-size: 0.9rem;
  color: #2b3242;
}

.raster-progress-bar {
  width: 100%;
  height: 0.75rem;
}
</style>
