import { BaseElement } from "../base-element/base-element";
import { storage } from "../data/storage";

export class BankTagsPage extends BaseElement {
  html() {
    return `{{bank-tags-page.html}}`;
  }

  connectedCallback() {
    super.connectedCallback();
    this.render();
    this.load();
  }

  async load() {
    const { groupName, groupToken } = storage.getGroup();
    const list = this.querySelector(".bank-tags-page__list");
    try {
      const response = await fetch(`/api/group/${encodeURIComponent(groupName)}/bank-tags`, {
        headers: { Authorization: groupToken },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      const tags = new Map(manifest.tags.filter((tag) => !tag.deleted).map((tag) => [tag.tagId, tag]));
      list.innerHTML =
        manifest.orderedTagIds
          .map((id) => {
            const tag = tags.get(id);
            return tag
              ? `<li class="rsborder-tiny rsbackground"><strong>${this.escape(tag.name)}</strong><span>revision ${
                  tag.revision
                }</span></li>`
              : "";
          })
          .join("") || "<li>No synchronized bank tags yet. Enable synchronization in Bank Tags Extended.</li>";
    } catch (failure) {
      list.innerHTML = `<li>Unable to load bank tags: ${this.escape(failure.message)}</li>`;
    }
  }

  escape(value) {
    const element = document.createElement("span");
    element.textContent = value;
    return element.innerHTML;
  }
}
customElements.define("bank-tags-page", BankTagsPage);
