package com.dentlink.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        int padding = getResources().getDimensionPixelSize(R.dimen.screen_padding);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(padding, padding, padding, padding);
        root.setBackgroundColor(getColor(R.color.dentlink_app_bg));

        TextView title = label(R.string.app_name, 28, true);
        EditText apiBase = input(DentLinkWidgetStore.apiBase(this), false);
        EditText email = input("", false);
        email.setHint(R.string.mobile_email_hint);
        EditText password = input("", true);
        password.setHint(R.string.mobile_password_hint);
        Button signIn = new Button(this);
        signIn.setText(R.string.mobile_sign_in_sync);
        Button sync = new Button(this);
        sync.setText(R.string.mobile_sync_widget);
        status = label(R.string.mobile_shell_placeholder, 16, false);

        root.addView(title);
        root.addView(apiBase);
        root.addView(email);
        root.addView(password);
        root.addView(signIn);
        root.addView(sync);
        root.addView(status);
        setContentView(root);

        signIn.setOnClickListener(
                view ->
                        runSync(
                                () ->
                                        DentLinkApiSync.loginAndSync(
                                                this,
                                                apiBase.getText().toString().trim(),
                                                email.getText().toString().trim(),
                                                password.getText().toString())));
        sync.setOnClickListener(view -> runSync(() -> DentLinkApiSync.syncWidgetCache(this)));
    }

    private TextView label(int stringId, int size, boolean strong) {
        TextView view = new TextView(this);
        view.setText(stringId);
        view.setTextColor(getColor(R.color.dentlink_text_primary));
        view.setTextSize(size);
        if (strong) view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        view.setPadding(0, 0, 0, 14);
        return view;
    }

    private EditText input(String value, boolean password) {
        EditText view = new EditText(this);
        view.setText(value);
        view.setTextColor(getColor(R.color.dentlink_text_primary));
        view.setHintTextColor(getColor(R.color.dentlink_text_muted));
        if (password) {
            view.setInputType(
                    android.text.InputType.TYPE_CLASS_TEXT
                            | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        }
        return view;
    }

    private void runSync(SyncOperation operation) {
        setBusy(true, getString(R.string.mobile_syncing));
        new Thread(
                        () -> {
                            try {
                                operation.run();
                                DentLinkWidgetProvider.refreshAllWidgets(this);
                                runOnUiThread(
                                        () -> setBusy(false, getString(R.string.mobile_sync_complete)));
                            } catch (Exception error) {
                                DentLinkWidgetStore.saveSyncError(this, error.getMessage());
                                DentLinkWidgetProvider.refreshAllWidgets(this);
                                runOnUiThread(() -> setBusy(false, error.getMessage()));
                            }
                        })
                .start();
    }

    private void setBusy(boolean busy, String message) {
        status.setText(message);
        status.setVisibility(View.VISIBLE);
    }

    private interface SyncOperation {
        void run() throws Exception;
    }
}
