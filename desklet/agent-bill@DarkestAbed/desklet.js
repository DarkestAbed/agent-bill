// agent-bill — Cinnamon desklet (barebones bootstrap).
// Language: JavaScript via GJS, modern ES6 class style (Cinnamon 5.4+ / LMDE 7).
// Entry point signature for a DESKLET is main(metadata, deskletId).

const Desklet = imports.ui.desklet;
const St = imports.gi.St;

class AgentBillDesklet extends Desklet.Desklet {
    constructor(metadata, deskletId) {
        super(metadata, deskletId);
        this.setHeader("Agent Bill");
    }

    // Called when the desklet is placed on the desktop. Build the UI here.
    on_desklet_added_to_desktop() {
        this._setupLayout();
    }

    _setupLayout() {
        const label = new St.Label({ text: "Hello from agent-bill" });
        this.setContent(label);
    }
}

function main(metadata, deskletId) {
    return new AgentBillDesklet(metadata, deskletId);
}
