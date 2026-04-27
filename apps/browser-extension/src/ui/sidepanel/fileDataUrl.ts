export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Icon upload did not produce a data URL."));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Icon upload failed.")));
    reader.readAsDataURL(file);
  });
}
