/**
 * Global test setup — extends Vitest matchers with @testing-library/jest-dom.
 *
 * Khởi tạo i18n một lần và ép về 'en' để component test render text tiếng Anh
 * xác định (không phụ thuộc navigator.language của jsdom). Test nào cần locale
 * khác tự gọi i18n.changeLanguage() trong beforeEach.
 */
import '@testing-library/jest-dom/vitest';
import i18n from './i18n/index';

void i18n.changeLanguage('en');
