// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getBody<T = any>(req: Request): Promise<T> {
  return req.json();
}
