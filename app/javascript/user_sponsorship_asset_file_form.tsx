import React from "react";
import { createRoot } from "react-dom/client";

import AssetFileForm, { AssetFileFormAPI } from "./AssetFileForm";
import { SponsorLogoValidator } from "./sponsor_logo_validator";

declare global {
  interface Window {
    rksSponsorshipAssetFileForms: React.RefObject<AssetFileFormAPI | null>[];
    rksTriggerAllUploads: () => Promise<(string | null)[]>;
  }
}

window.rksSponsorshipAssetFileForms = [];

window.rksTriggerAllUploads = async () => {
  return Promise.all(
    window.rksSponsorshipAssetFileForms.map(
      (ref) => ref.current?.ensureUpload() ?? Promise.resolve(null),
    ),
  );
};

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".sponsorships_form").forEach((formElem) => {
    const form = formElem as HTMLFormElement;
    const errorElem = form.querySelector(".submit_error") as HTMLDivElement;
    form.querySelectorAll(".sponsorships_form_asset_file").forEach((elem_) => {
      const elem = elem_ as HTMLDivElement;
      const dest = elem.querySelector(".sponsorships_form_asset_file_form");

      const fileIdElem = elem.querySelector(
        'input[type=hidden][name="sponsorship[asset_file_id]"]',
      ) as HTMLInputElement;
      const fileIdToCopyElem = elem.querySelector(
        'input[type=hidden][name="sponsorship[asset_file_id_to_copy]"]',
      ) as HTMLInputElement | undefined;
      if (!fileIdElem) return;
      const existingFileId =
        fileIdElem.value.length > 0 ? fileIdElem.value : null;
      const doCopy = (fileIdToCopyElem?.value ?? "").length > 0;

      const sessionEndpoint = elem.dataset.sessionEndpoint;
      const sessionEndpointMethod = elem.dataset.sessionEndpointMethod;
      if (!sessionEndpoint || !sessionEndpointMethod) return;

      const logoPreview = form.querySelector<HTMLElement>(
        ".sponsorships_form_logo_preview",
      );
      const logoConfirmation = form.querySelector<HTMLInputElement>(
        'input[type="checkbox"][name="sponsorship[logo_confirmation]"]',
      );
      const logoValidator =
        logoPreview && logoConfirmation
          ? new SponsorLogoValidator(logoPreview, logoConfirmation)
          : null;

      const onFileChange = (file: File | null) => {
        void logoValidator?.validate(file);
      };

      const componentRef = React.createRef<AssetFileFormAPI>();

      if (!dest) {
        console.error("Destination element not found for AssetFileForm");
        return;
      }

      const root = createRoot(dest);
      root.render(
        <AssetFileForm
          ref={componentRef}
          needUpload={doCopy ? false : !existingFileId}
          existingFileId={existingFileId}
          sessionEndpoint={sessionEndpoint}
          sessionEndpointMethod={sessionEndpointMethod}
          accept="image/png,image/jpeg"
          onFileChange={onFileChange}
        />,
      );

      // Add ref to global array - it will be populated when component mounts
      window.rksSponsorshipAssetFileForms.push(componentRef);
      console.log(
        "Registered AssetFileForm (ref will be available after mount)",
      );
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        form
          .querySelectorAll("input[type=submit]")
          .forEach((el) => ((el as HTMLInputElement).disabled = true));
        try {
          errorElem.classList.add("d-none");
          if (!componentRef.current) {
            throw new Error("AssetFileForm ref is not available");
          }
          const fileId = await componentRef.current.ensureUpload();
          if (fileId !== null) {
            fileIdElem.value = fileId;
            // Recheck in case another field changed while the upload was running.
            if (form.reportValidity()) {
              form.submit();
              return;
            }
          }
          form
            .querySelectorAll("input[type=submit]:disabled")
            .forEach((el) => ((el as HTMLInputElement).disabled = false));
        } catch (e) {
          errorElem.textContent = `ERROR: ${e}`;
          errorElem.classList.remove("d-none");
          form
            .querySelectorAll("input[type=submit]:disabled")
            .forEach((el) => ((el as HTMLInputElement).disabled = false));
        }
      });
    });
  });
});
