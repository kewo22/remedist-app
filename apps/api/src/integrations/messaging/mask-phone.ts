/** "+9477***67": enough to tell messages apart in logs without recording the number. */
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}
