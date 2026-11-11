export function requiresPbxCallSelection(
  channel: string,
  contactResult: string,
  isEditing: boolean,
): boolean {
  return channel === 'Llamada' && contactResult === 'Sí' && !isEditing;
}
