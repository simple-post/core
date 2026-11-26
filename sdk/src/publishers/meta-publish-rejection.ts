/** A structured, non-transient client error confirms that Meta rejected the publish request. */
export function isMetaPublishRejection(error: unknown): boolean {
  const response = (
    error as
      | {
          response?: { status?: number; data?: { error?: { code?: number; is_transient?: boolean } } };
        }
      | undefined
  )?.response;
  const provider = response?.data?.error;
  return (
    (response?.status === 400 || response?.status === 403) &&
    typeof provider?.code === "number" &&
    [10, 100, 190, 200, 368, 9007].includes(provider.code) &&
    !provider.is_transient
  );
}
