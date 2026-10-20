// Small "select all rows" checkbox for a table's leading bulk-select
// column header — ref-based since React has no plain prop for the native
// checkbox's `indeterminate` state. `stopPropagation` keeps a click here
// from also triggering the header's own column-sort handler (SortableTable
// puts an `onClick` on every `<th>`).
export default function SelectAllCheckbox({ checked, indeterminate, onChange }) {
  return (
    <input
      type="checkbox"
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label="Select all rows"
    />
  );
}
