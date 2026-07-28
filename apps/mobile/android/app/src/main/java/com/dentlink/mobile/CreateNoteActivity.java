package com.dentlink.mobile;

import android.app.Activity;
import android.content.Context;
import android.os.Bundle;
import android.text.InputType;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class CreateNoteActivity extends Activity {
    private EditText titleInput;
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);

        int padding = getResources().getDimensionPixelSize(R.dimen.screen_padding);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(padding, padding, padding, padding);
        root.setBackgroundColor(getColor(R.color.dentlink_surface_bg));

        TextView title = new TextView(this);
        title.setText(R.string.widget_new_note_title);
        title.setTextColor(getColor(R.color.dentlink_text_primary));
        title.setTextSize(22);
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        title.setPadding(0, 0, 0, 12);

        titleInput = new EditText(this);
        titleInput.setHint(R.string.widget_note_title_hint);
        titleInput.setSingleLine(true);
        titleInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        titleInput.setTextColor(getColor(R.color.dentlink_text_primary));
        titleInput.setHintTextColor(getColor(R.color.dentlink_text_muted));
        titleInput.setLayoutParams(
                new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        Button save = new Button(this);
        save.setText(R.string.widget_save_note);
        Button cancel = new Button(this);
        cancel.setText(android.R.string.cancel);
        status = new TextView(this);
        status.setTextColor(getColor(R.color.dentlink_text_secondary));
        status.setPadding(0, 10, 0, 0);

        root.addView(title);
        root.addView(titleInput);
        root.addView(save);
        root.addView(cancel);
        root.addView(status);
        setContentView(root);
        getWindow()
                .setLayout(
                        (int) (getResources().getDisplayMetrics().widthPixels * 0.94f),
                        WindowManager.LayoutParams.WRAP_CONTENT);

        save.setOnClickListener(view -> saveNote());
        cancel.setOnClickListener(view -> finish());
        titleInput.requestFocus();
        titleInput.postDelayed(
                () -> {
                    InputMethodManager manager =
                            (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                    if (manager != null) manager.showSoftInput(titleInput, InputMethodManager.SHOW_IMPLICIT);
                },
                200);
    }

    private void saveNote() {
        String title = titleInput.getText().toString().trim();
        if (title.isEmpty()) {
            titleInput.setError(getString(R.string.widget_note_title_required));
            return;
        }
        status.setText(R.string.mobile_syncing);
        new Thread(
                        () -> {
                            try {
                                DentLinkApiSync.createNote(this, title);
                                DentLinkWidgetStore.setActiveTab(this, DentLinkWidgetStore.TAB_NOTES);
                                DentLinkWidgetProvider.refreshAllWidgets(this);
                                runOnUiThread(this::finish);
                            } catch (Exception error) {
                                DentLinkWidgetStore.saveSyncError(this, error.getMessage());
                                DentLinkWidgetProvider.refreshAllWidgets(this);
                                runOnUiThread(() -> status.setText(error.getMessage()));
                            }
                        })
                .start();
    }
}
