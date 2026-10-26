// agent-bill — masked API-key entry dialog (dark theme).
// Opened from the settings "Enter … API key" buttons. The typed key is sent
// straight to libsecret; it is never displayed or persisted in plaintext.

const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const ModalDialog = imports.ui.modalDialog;

const Ui = (() => {
    const Me = imports.misc.extensionUtils.getCurrentExtension();
    return Me.imports.lib.ui;
})();

const COLORS = {
    background: '#1e1e2e',
    surface:    '#2a2a3c',
    text:       '#e6e6ef',
    textDim:    '#9a9ab0',
    accent:     '#89b4fa',
    track:      '#3b3b52',
};

// showKeyDialog({ title, description, onSubmit })
// onSubmit(key) is called with the entered string when the user confirms.
function showKeyDialog({ title, description, onSubmit }) {
    const dialog = new ModalDialog.ModalDialog({ styleClass: 'agent-bill-dialog' });

    const titleLabel = new St.Label({
        text: title,
        style: `color: ${COLORS.text}; font-size: 16px; font-weight: bold;`,
    });
    const descLabel = new St.Label({
        text: description,
        style: `color: ${COLORS.textDim}; font-size: 12px;`,
    });

    const entry = new St.Entry({
        style: `background-color: ${COLORS.surface}; color: ${COLORS.text};` +
               `border: 1px solid ${COLORS.track}; border-radius: 8px; padding: 8px;`,
        can_focus: true,
    });
    // Mask the key as it is typed.
    entry.clutter_text.set_password_char(Clutter.UnicodeChar.BULLET);

    const errorLabel = new St.Label({
        text: '',
        style: `color: ${COLORS.bad}; font-size: 12px;`,
    });

    const saveButton = new St.Button({
        label: 'Save to keyring',
        style: `background-color: ${COLORS.accent}; color: #11111b;` +
               `border-radius: 8px; padding: 8px 16px; font-weight: bold;`,
        can_focus: true,
    });
    const cancelButton = new St.Button({
        label: 'Cancel',
        style: `background-color: ${COLORS.track}; color: ${COLORS.text};` +
               `border-radius: 8px; padding: 8px 16px;`,
        can_focus: true,
    });

    saveButton.connect('clicked', () => {
        const key = entry.get_text().trim();
        if (!key) {
            errorLabel.set_text('Please enter a key.');
            return;
        }
        onSubmit(key);
        dialog.close();
    });
    cancelButton.connect('clicked', () => dialog.close());
    entry.connect('activate', () => saveButton.emit('clicked'));

    const buttonRow = new St.BoxLayout({ style: 'spacing: 10px;' });
    buttonRow.add_child(cancelButton);
    buttonRow.add_child(saveButton);

    const content = new St.BoxLayout({ vertical: true, style: 'spacing: 12px;' });
    content.add_child(titleLabel);
    content.add_child(descLabel);
    content.add_child(entry);
    content.add_child(errorLabel);
    content.add_child(buttonRow);

    dialog.setButtons([]); // we manage our own buttons
    dialog.contentLayout.add_child(content);

    dialog.open();
    entry.grab_key_focus();
}
