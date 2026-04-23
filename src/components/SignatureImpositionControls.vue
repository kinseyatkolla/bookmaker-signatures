<script setup>
import { toRefs } from "vue";

const props = defineProps({
  form: { type: Object, required: true },
  summary: { type: Object, required: true },
  layout: { type: Object, required: true },
  handlers: { type: Object, required: true },
});
const { form, summary, layout, handlers } = toRefs(props);

const emit = defineEmits(["update:field"]);

function parseNumberInput(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function updateField(key, value) {
  emit("update:field", { key, value });
}
</script>

<template>
  <div class="grid">
    <div class="field field-full size-groups">
      <section class="size-group">
        <h3>Page</h3>
        <label class="field">
          <span>Width (inches)</span>
          <input
            :value="form.pageWidth"
            type="number"
            name="imposition-page-width"
            min="0.1"
            step="0.1"
            @input="
              updateField(
                'pageWidth',
                parseNumberInput($event.target.value, form.pageWidth),
              )
            "
          />
        </label>
        <label class="field">
          <span>Height (inches)</span>
          <input
            :value="form.pageHeight"
            type="number"
            name="imposition-page-height"
            min="0.1"
            step="0.1"
            @input="
              updateField(
                'pageHeight',
                parseNumberInput($event.target.value, form.pageHeight),
              )
            "
          />
        </label>
      </section>

      <section class="size-group">
        <h3>Signatures</h3>
        <label class="field">
          <span>Sheets Per Signature</span>
          <input
            :value="form.sheetsPerSignature"
            type="number"
            name="imposition-sheets-per-signature"
            min="1"
            step="1"
            :disabled="form.signatureCalcMode === 'signatures-fixed'"
            @input="handlers.onSheetsPerSignatureInput"
          />
          <small v-if="form.signatureCalcMode === 'signatures-fixed'"
            >Auto-calculated from uploaded pages and fixed signatures.</small
          >
        </label>
        <label class="field">
          <span>Number of Signatures</span>
          <input
            :value="form.numberOfSignatures"
            type="number"
            name="imposition-number-of-signatures"
            min="1"
            step="1"
            :disabled="form.signatureCalcMode === 'sheets-fixed'"
            @input="handlers.onNumberOfSignaturesInput"
          />
          <small v-if="form.signatureCalcMode === 'sheets-fixed'"
            >Auto-calculated from uploaded pages and fixed sheets per
            signature.</small
          >
        </label>
      </section>

      <section class="size-group">
        <h3>Signature Calculation Mode</h3>
        <div class="mode-toggle">
          <label>
            <input
              :checked="form.signatureCalcMode === 'sheets-fixed'"
              type="radio"
              name="imposition-signature-calc-mode"
              value="sheets-fixed"
              @change="updateField('signatureCalcMode', 'sheets-fixed')"
            />
            Lock Sheets Per Signature (auto-calculate Number of Signatures)
          </label>
          <label>
            <input
              :checked="form.signatureCalcMode === 'signatures-fixed'"
              type="radio"
              name="imposition-signature-calc-mode"
              value="signatures-fixed"
              @change="updateField('signatureCalcMode', 'signatures-fixed')"
            />
            Lock Number of Signatures (auto-calculate Sheets Per Signature)
          </label>
        </div>
      </section>

      <section class="size-group">
        <h3>Output</h3>
        <label class="field">
          <span>Width (inches)</span>
          <input
            :value="form.outputWidth"
            type="number"
            name="imposition-output-width"
            min="0.1"
            step="0.1"
            @input="
              updateField(
                'outputWidth',
                parseNumberInput($event.target.value, form.outputWidth),
              )
            "
          />
        </label>
        <label class="field">
          <span>Height (inches)</span>
          <input
            :value="form.outputHeight"
            type="number"
            name="imposition-output-height"
            min="0.1"
            step="0.1"
            @input="
              updateField(
                'outputHeight',
                parseNumberInput($event.target.value, form.outputHeight),
              )
            "
          />
        </label>
      </section>
    </div>

    <div class="field field-full size-groups">
      <section class="size-group size-group--gaps">
        <h3>Gaps</h3>
        <label class="field">
          <span>Vertical gap (in)</span>
          <input
            :value="form.verticalGap"
            type="number"
            name="imposition-vertical-gap"
            min="0"
            step="0.01"
            @input="
              updateField(
                'verticalGap',
                parseNumberInput($event.target.value, form.verticalGap),
              )
            "
          />
        </label>
        <label class="field">
          <span>Horizontal gap (in)</span>
          <input
            :value="form.horizontalGap"
            type="number"
            name="imposition-horizontal-gap"
            min="0"
            step="0.01"
            @input="
              updateField(
                'horizontalGap',
                parseNumberInput($event.target.value, form.horizontalGap),
              )
            "
          />
        </label>
      </section>
      <section class="size-group size-group--gaps">
        <h3>Crop marks</h3>
        <label class="field checkbox-field" for="show-crop-marks">
          <input
            id="show-crop-marks"
            :checked="form.showCropMarks"
            type="checkbox"
            name="imposition-show-crop-marks"
            @change="updateField('showCropMarks', $event.target.checked)"
          />
          <span>Show crop marks</span>
        </label>
        <label class="field">
          <span>Crop Mark Offset (in)</span>
          <input
            :value="form.cropMarkOffset"
            type="number"
            name="imposition-crop-mark-offset"
            min="0.01"
            step="0.01"
            :disabled="!form.showCropMarks"
            @input="
              updateField(
                'cropMarkOffset',
                parseNumberInput($event.target.value, form.cropMarkOffset),
              )
            "
          />
        </label>
        <label class="field">
          <span>Crop Mark Length (in)</span>
          <input
            :value="form.cropMarkLength"
            type="number"
            name="imposition-crop-mark-length"
            min="0.01"
            step="0.01"
            :disabled="!form.showCropMarks"
            @input="
              updateField(
                'cropMarkLength',
                parseNumberInput($event.target.value, form.cropMarkLength),
              )
            "
          />
        </label>
      </section>
      <section class="size-group size-group--gaps">
        <h3>Image Bleed (in)</h3>
        <label class="field">
          <span>Top</span>
          <input
            :value="form.bleedTop"
            type="number"
            name="imposition-bleed-top"
            min="0"
            step="0.01"
            @input="
              updateField(
                'bleedTop',
                parseNumberInput($event.target.value, form.bleedTop),
              )
            "
          />
        </label>
        <label class="field">
          <span>Right</span>
          <input
            :value="form.bleedRight"
            type="number"
            name="imposition-bleed-right"
            min="0"
            step="0.01"
            @input="
              updateField(
                'bleedRight',
                parseNumberInput($event.target.value, form.bleedRight),
              )
            "
          />
        </label>
        <label class="field">
          <span>Bottom</span>
          <input
            :value="form.bleedBottom"
            type="number"
            name="imposition-bleed-bottom"
            min="0"
            step="0.01"
            @input="
              updateField(
                'bleedBottom',
                parseNumberInput($event.target.value, form.bleedBottom),
              )
            "
          />
        </label>
        <label class="field">
          <span>Left</span>
          <input
            :value="form.bleedLeft"
            type="number"
            name="imposition-bleed-left"
            min="0"
            step="0.01"
            @input="
              updateField(
                'bleedLeft',
                parseNumberInput($event.target.value, form.bleedLeft),
              )
            "
          />
        </label>
        <small
          >0 keeps current behavior. Bleed extends image beyond trim and is clipped
          to the page slot.</small
        >
        <small
          >Expected source image size: width = page width + left + right bleed;
          height = page height + top + bottom bleed.</small
        >
      </section>
      <section class="size-group size-group--summary">
        <label class="field">
          <span>Number of Pages (used when no images are uploaded)</span>
          <input
            :value="form.numberOfPages"
            type="number"
            name="imposition-number-of-pages"
            min="0"
            step="1"
            :disabled="summary.uploadedPageCount > 0"
            @input="handlers.onNumberOfPagesInput"
          />
          <small v-if="summary.uploadedPageCount > 0">
            Disabled while images are uploaded (using
            {{ summary.uploadedPageCount }} uploaded page{{
              summary.uploadedPageCount === 1 ? "" : "s"
            }}
            instead).
          </small>
          <small v-else>
            Generating placeholders for {{ summary.effectivePageCount }} page{{
              summary.effectivePageCount === 1 ? "" : "s"
            }}.
          </small>
        </label>
        <h3>Imposition summary</h3>
        <div class="stats stats--summary">
          <p>
            <strong>Sheets per output:</strong>
            {{ summary.sheetsPerOutputCount }} ({{ summary.outputLayoutCols }} ×
            {{ summary.outputLayoutRows }})
          </p>
          <p><strong>Pages per signature:</strong> {{ summary.pagesPerSignature }}</p>
          <p><strong>Total page capacity:</strong> {{ summary.totalCapacityPages }}</p>
          <p>
            <strong>Input page source:</strong>
            {{
              summary.usingManualPageCount
                ? `Manual (${summary.effectivePageCount} pages)`
                : `Uploaded images (${summary.effectivePageCount} pages)`
            }}
          </p>
          <p><strong>Blank pages needed:</strong> {{ summary.blankPagesNeeded }}</p>
        </div>
      </section>
    </div>
  </div>

  <hr />

  <div class="pdf-output">
    <div class="pdf-output-top-row">
      <div class="pdf-output-controls-column">
        <div class="field">
          <span>Fold between page halves (each grid cell)</span>
          <div class="mode-toggle mode-toggle-inline">
            <label>
              <input
                :checked="form.outputFoldAxis === 'vertical'"
                type="radio"
                name="imposition-output-fold-axis"
                value="vertical"
                @change="updateField('outputFoldAxis', 'vertical')"
              />
              Vertical fold (pages left and right)
            </label>
            <label>
              <input
                :checked="form.outputFoldAxis === 'horizontal'"
                type="radio"
                name="imposition-output-fold-axis"
                value="horizontal"
                @change="updateField('outputFoldAxis', 'horizontal')"
              />
              Horizontal fold (pages stacked)
            </label>
          </div>
          <small
            >Each grid cell is one physical sheet. Gaps and crop marks are in
            the row under Page / Signatures / Output.</small
          >
        </div>
        <div class="field output-layout-field">
          <span>Sheets on output (drag cells)</span>
          <p class="output-layout-summary">
            {{ summary.outputLayoutCols }}×{{ summary.outputLayoutRows }} ({{
              summary.sheetsPerOutputCount
            }}
            sheet{{ summary.sheetsPerOutputCount === 1 ? "" : "s" }})
          </p>
          <div
            class="output-layout-grid"
            role="grid"
            :aria-label="`Select output layout, currently ${summary.outputLayoutCols} by ${summary.outputLayoutRows}`"
          >
            <div
              v-for="row in layout.outputLayoutGridMax"
              :key="`layout-row-${row}`"
              class="output-layout-row"
            >
              <button
                v-for="col in layout.outputLayoutGridMax"
                :key="`layout-cell-${row}-${col}`"
                type="button"
                class="output-layout-cell"
                :class="{
                  'output-layout-cell--preview': layout.layoutCellInDragPreview(
                    col - 1,
                    row - 1,
                  ),
                  'output-layout-cell--active': layout.layoutCellCommitted(
                    col - 1,
                    row - 1,
                  ),
                }"
                :aria-pressed="
                  layout.layoutCellCommitted(col - 1, row - 1) ? 'true' : 'false'
                "
                @pointerdown="
                  handlers.onOutputLayoutPointerDown(col - 1, row - 1, $event)
                "
                @pointerenter="handlers.onOutputLayoutPointerEnter(col - 1, row - 1)"
              />
            </div>
          </div>
          <small
            >Click or drag to select a rectangle. Each cell is one sheet (two
            pages touch at the fold). Spacing between cells uses the gaps in
            the row under Page / Signatures / Output.</small
          >
        </div>
      </div>
      <div class="pdf-output-preview-column">
        <h2>Actual-Size PDF Output</h2>
        <div class="layout-preview">
          <svg
            class="layout-preview-svg"
            :viewBox="`0 0 ${layout.layoutPreview.outputWidth} ${layout.layoutPreview.outputHeight}`"
            role="img"
            aria-label="Layout preview for sheets on output sheet"
          >
            <rect
              x="0"
              y="0"
              :width="layout.layoutPreview.outputWidth"
              :height="layout.layoutPreview.outputHeight"
              class="preview-output-boundary"
            />
            <g
              v-for="(sheet, index) in layout.layoutPreview.sheets"
              :key="`sheet-preview-${index}`"
            >
              <rect
                :x="sheet.pageA.x"
                :y="sheet.pageA.y"
                :width="sheet.pageA.width"
                :height="sheet.pageA.height"
                class="preview-sheet"
              />
              <rect
                :x="sheet.pageB.x"
                :y="sheet.pageB.y"
                :width="sheet.pageB.width"
                :height="sheet.pageB.height"
                class="preview-sheet"
              />
            </g>
          </svg>
          <p class="note">
            Output: {{ layout.formatInchesLabel(layout.layoutPreview.outputWidth) }}" x
            {{ layout.formatInchesLabel(layout.layoutPreview.outputHeight) }}" |
            Required:
            {{ layout.formatInchesLabel(layout.layoutPreview.requiredWidth) }}" x
            {{ layout.formatInchesLabel(layout.layoutPreview.requiredHeight) }}"
          </p>
          <p class="note">
            Sheet footprint:
            {{ layout.formatInchesLabel(layout.layoutPreview.sheetLayoutWidth) }}" x
            {{ layout.formatInchesLabel(layout.layoutPreview.sheetLayoutHeight) }}".
            Fold:
            {{
              layout.layoutPreview.foldHorizontal
                ? "horizontal (stacked)"
                : "vertical (left and right)"
            }}
            . Between columns:
            {{ layout.formatInchesLabel(layout.layoutPreview.gapBetweenCols) }}";
            between rows:
            {{ layout.formatInchesLabel(layout.layoutPreview.gapBetweenRows) }}".
          </p>
        </div>
      </div>
    </div>
    <p v-if="!layout.layoutFit.fits" class="warning">
      This combination overflows the output page at actual size, which causes
      clipped scaling/crop marks. Reduce page size, sheet footprint, or gap
      values.
    </p>
  </div>
</template>
