import assert from 'node:assert/strict';

import {
  calculateContainedImageSize,
  STUDENT_CARD_IMAGE_RULES,
} from '../src/utils/imageUtils.ts';

assert.deepEqual(
  calculateContainedImageSize(6000, 4000, 1920, 1920),
  { width: 1920, height: 1280 },
  'large landscape photos should fit without changing their ratio',
);

assert.deepEqual(
  calculateContainedImageSize(3000, 6000, 1920, 1920),
  { width: 960, height: 1920 },
  'portrait photos should fit without changing their ratio',
);

assert.deepEqual(
  calculateContainedImageSize(1280, 800, 1920, 1920),
  { width: 1280, height: 800 },
  'small readable sources should not be upscaled',
);

assert.equal(STUDENT_CARD_IMAGE_RULES.outputQuality, 0.94);
assert.equal(STUDENT_CARD_IMAGE_RULES.maxOutputBytes, 8 * 1024 * 1024);
assert.throws(() => calculateContainedImageSize(0, 100, 1920, 1920));
await assert.rejects(
  () => import('../src/utils/imageUtils.ts').then(({ prepareStudentCardImage }) => (
    prepareStudentCardImage(new File(['not-an-image'], 'card.txt', { type: 'text/plain' }))
  )),
  /JPEG หรือ PNG/,
);
await assert.rejects(
  () => import('../src/utils/imageUtils.ts').then(({ prepareStudentCardImage }) => (
    prepareStudentCardImage(new File([], 'empty.png', { type: 'image/png' }))
  )),
  /ไฟล์ว่าง/,
);

console.log('Student-card image sizing tests passed.');
