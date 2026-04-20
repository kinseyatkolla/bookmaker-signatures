<script setup>
const props = defineProps({
  state: { type: Object, required: true },
  handlers: { type: Object, required: true },
});

const { state, handlers } = props;
</script>

<template>
  <div class="actions">
    <button
      type="button"
      class="primary-button"
      :disabled="state.isGeneratingPdf"
      @click="handlers.generatePdfOutput"
    >
      {{ state.isGeneratingPdf ? "Generating..." : "Generate PDF Output" }}
    </button>
    <small v-if="state.pdfError" class="error-text">{{ state.pdfError }}</small>
  </div>

  <div v-if="state.combinedPdfUrl" class="download-group">
    <button
      type="button"
      class="small-button"
      @click="handlers.downloadCombinedPdf"
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
