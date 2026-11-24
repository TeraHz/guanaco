import {
  containsHtmlMarkup,
  htmlToPlainText,
  serializeDescriptionForServer,
} from '../htmlDescription';

describe('htmlDescription utility (Vikunja TipTap HTML <-> mobile readable text)', () => {
  describe('containsHtmlMarkup', () => {
    it('detects real HTML tags while ignoring plain math inequalities or empty strings', () => {
      expect(containsHtmlMarkup('')).toBe(false);
      expect(containsHtmlMarkup(undefined)).toBe(false);
      expect(containsHtmlMarkup('Buy 2 < 5 apples & milk > 1 gallon')).toBe(false);
      expect(containsHtmlMarkup('<p>Hello world</p>')).toBe(true);
      expect(containsHtmlMarkup('Line 1<br/>Line 2')).toBe(true);
      expect(containsHtmlMarkup('<ul data-type="taskList"><li>Item</li></ul>')).toBe(true);
    });
  });

  describe('htmlToPlainText', () => {
    it('returns plain text unchanged when no HTML markup is present', () => {
      expect(htmlToPlainText('Plain multiline\nnote with 3 < 5')).toBe(
        'Plain multiline\nnote with 3 < 5'
      );
    });

    it('converts paragraphs, line breaks, unordered lists, and ordered lists cleanly', () => {
      const html =
        '<p>First paragraph</p><p>Second<br>line</p><ul><li><p>Milk</p></li><li><p>Eggs</p></li></ul><ol><li><p>Preheat</p></li><li><p>Bake</p></li></ol>';
      expect(htmlToPlainText(html)).toBe(
        'First paragraph\n\nSecond\nline\n\n• Milk\n• Eggs\n\n1. Preheat\n2. Bake'
      );
    });

    it('converts Vikunja TipTap taskList checkboxes into readable - [x] / - [ ] items', () => {
      const html =
        '<ul data-type="taskList">' +
        '<li data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Renew passport</p></div></li>' +
        '<li data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Book flights</p></div></li>' +
        '</ul>';
      expect(htmlToPlainText(html)).toBe('- [x] Renew passport\n- [ ] Book flights');
    });

    it('preserves anchor href URLs when different from label and avoids duplication when identical', () => {
      const html =
        '<p>Read <a href="https://vikunja.io/docs">Documentation</a> or visit <a href="https://example.com">https://example.com</a></p>';
      expect(htmlToPlainText(html)).toBe(
        'Read Documentation (https://vikunja.io/docs) or visit https://example.com'
      );
    });

    it('decodes named, decimal, and hex HTML entities in a single safe pass without double-unescaping', () => {
      const html = '<p>AT&amp;T &mdash; &quot;smart&quot; &#39;quote&#39; &#x2022; &amp;lt;literal&amp;gt;</p>';
      expect(htmlToPlainText(html)).toBe('AT&T — "smart" \'quote\' • &lt;literal&gt;');
    });

    it('strips script and style blocks completely', () => {
      const html = '<style>body{color:red}</style><p>Safe note</p><script>alert(1)</script>';
      expect(htmlToPlainText(html)).toBe('Safe note');
    });
  });

  describe('serializeDescriptionForServer', () => {
    it('preserves original server HTML verbatim when description was NOT modified by user', () => {
      const complexHtml = '<table><tr><td>Keep exact HTML</td></tr></table>';
      expect(serializeDescriptionForServer('Keep exact HTML', complexHtml, false)).toBe(
        complexHtml
      );
    });

    it('saves plain trimmed text directly when original task had plain text (or no original)', () => {
      expect(serializeDescriptionForServer('  Fresh plain note  ', '', true)).toBe(
        'Fresh plain note'
      );
      expect(serializeDescriptionForServer('Edited note', 'Old plain note', true)).toBe(
        'Edited note'
      );
    });

    it('serializes edited paragraphs, bullets, and checklists back into clean escaped HTML when original was HTML', () => {
      const originalHtml = '<p>Old paragraph</p>';
      const edited = 'AT&T <account>\n\n- [x] Paid bill\n- [ ] File receipt\n\n• Folder A';
      const serialized = serializeDescriptionForServer(edited, originalHtml, true);

      expect(serialized).toBe(
        '<p>AT&amp;T &lt;account&gt;</p>' +
          '<ul data-type="taskList"><li data-checked="true"><p>Paid bill</p></li><li data-checked="false"><p>File receipt</p></li></ul>' +
          '<ul><li><p>Folder A</p></li></ul>'
      );

      // Clearing an HTML description returns empty string
      expect(serializeDescriptionForServer('   ', originalHtml, true)).toBe('');
    });
  });
});
