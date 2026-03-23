const INTERACTIVE_SELECTOR =
  'button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="switch"], [tabindex], [aria-haspopup], [aria-controls], [style*="cursor: pointer"], [style*="cursor:pointer"], .cursor-pointer';

const INTERACTIVE_ACTIONS = {
  CLICK: 'click',
  HOVER: 'hover',
  TYPE_TEXT: 'type_text',
  CHECK_TOGGLE: 'check_toggle',
  SELECT_OPTION: 'select_option',
  RANGE: 'range'
};

const INTERACTION_DELAY_MS = 1200;
const SAMPLE_INPUT_VALUE = 'Sample input';

module.exports = {
  INTERACTIVE_SELECTOR,
  INTERACTIVE_ACTIONS,
  INTERACTION_DELAY_MS,
  SAMPLE_INPUT_VALUE
};
