package com.dentlink.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class DentLinkWidgetStore {
    private static final int MAX_CACHED_RENDER_ITEMS = 40;
    private static final String PREFS = "dentlink_widget_cache";
    private static final String KEY_API_BASE = "api_base";
    private static final String KEY_SESSION_TOKEN = "session_token";
    private static final String KEY_ACTIVE_TAB = "active_tab";
    private static final String KEY_CALENDAR = "calendar_json";
    private static final String KEY_NOTES = "notes_json";
    private static final String KEY_EMAILS = "emails_json";
    private static final String KEY_REFRESH_REQUESTED = "refresh_requested_at";
    private static final String KEY_LAST_SYNC = "last_sync_at";
    private static final String KEY_LAST_ERROR = "last_error";
    private static final String KEY_WIDGET_CLIENT_ID = "widget_client_id";
    private static final String KEY_SEEN_CALENDAR = "seen_calendar_ids";
    private static final String KEY_SEEN_NOTES = "seen_notes_ids";
    private static final String KEY_SEEN_EMAILS = "seen_emails_ids";
    private static final String KEY_NEW_CALENDAR = "new_calendar";
    private static final String KEY_NEW_NOTES = "new_notes";
    private static final String KEY_NEW_EMAILS = "new_emails";
    private static final String KEY_COMPLETING_NOTES = "completing_note_ids";
    private static final String KEY_DISMISSING_EMAILS = "dismissing_email_ids";
    static final String TAB_CALENDAR = "calendar";
    static final String TAB_NOTES = "notes";
    static final String TAB_EMAILS = "emails";

    private DentLinkWidgetStore() {}

    static WidgetState load(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String activeTab = normalizeTab(prefs.getString(KEY_ACTIVE_TAB, TAB_CALENDAR));

        List<WidgetItem> calendar = parseItems(prefs.getString(KEY_CALENDAR, "[]"), "");
        List<WidgetItem> notes =
                parseItems(prefs.getString(KEY_NOTES, "[]"), prefs.getString(KEY_COMPLETING_NOTES, ""));
        List<WidgetItem> emails =
                parseItems(prefs.getString(KEY_EMAILS, "[]"), prefs.getString(KEY_DISMISSING_EMAILS, ""));
        String error = prefs.getString(KEY_LAST_ERROR, "");
        String statusText;
        if (prefs.contains(KEY_REFRESH_REQUESTED)) {
            statusText = context.getString(R.string.widget_refresh_requested);
        } else if (prefs.contains(KEY_LAST_SYNC)) {
            statusText = context.getString(
                    R.string.widget_last_sync,
                    formatLastSync(prefs.getLong(KEY_LAST_SYNC, System.currentTimeMillis())));
        } else if (error != null && !error.isEmpty()) {
            statusText = context.getString(R.string.widget_sync_error);
        } else {
            statusText = context.getString(R.string.widget_not_synced);
        }

        return new WidgetState(
                activeTab,
                calendar,
                notes,
                emails,
                statusText,
                prefs.getBoolean(KEY_NEW_CALENDAR, false),
                prefs.getBoolean(KEY_NEW_NOTES, false),
                prefs.getBoolean(KEY_NEW_EMAILS, false));
    }

    static void setActiveTab(Context context, String tab) {
        String nextTab = normalizeTab(tab);
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit().putString(KEY_ACTIVE_TAB, nextTab);
        if (TAB_NOTES.equals(nextTab)) {
            editor.putBoolean(KEY_NEW_NOTES, false).putString(KEY_SEEN_NOTES, idsFor(KEY_NOTES, prefs));
        } else if (TAB_EMAILS.equals(nextTab)) {
            editor.putBoolean(KEY_NEW_EMAILS, false).putString(KEY_SEEN_EMAILS, idsFor(KEY_EMAILS, prefs));
        } else {
            editor.putBoolean(KEY_NEW_CALENDAR, false).putString(KEY_SEEN_CALENDAR, idsFor(KEY_CALENDAR, prefs));
        }
        editor.commit();
    }

    static void markRefreshRequested(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putLong(KEY_REFRESH_REQUESTED, System.currentTimeMillis())
                .remove(KEY_LAST_ERROR)
                .commit();
    }

    static void markNoteCompleting(Context context, String noteId) {
        if (noteId == null || noteId.isEmpty()) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String current = prefs.getString(KEY_COMPLETING_NOTES, "");
        if (containsId(current, noteId)) return;
        String next = current == null || current.isEmpty() ? noteId : current + "," + noteId;
        prefs.edit().putString(KEY_COMPLETING_NOTES, next).commit();
    }

    static void markEmailDismissing(Context context, String emailId) {
        if (emailId == null || emailId.isEmpty()) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String current = prefs.getString(KEY_DISMISSING_EMAILS, "");
        if (containsId(current, emailId)) return;
        String next = current == null || current.isEmpty() ? emailId : current + "," + emailId;
        prefs.edit().putString(KEY_DISMISSING_EMAILS, next).commit();
    }

    static void saveSession(Context context, String apiBase, String token) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_API_BASE, apiBase)
                .putString(KEY_SESSION_TOKEN, token)
                .remove(KEY_LAST_ERROR)
                .commit();
    }

    static String apiBase(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_API_BASE, DentLinkApiSync.DEFAULT_API_BASE);
    }

    static String sessionToken(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SESSION_TOKEN, "");
    }

    static String widgetClientId(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String existing = prefs.getString(KEY_WIDGET_CLIENT_ID, "");
        if (existing != null && !existing.isEmpty()) return existing;
        String next = "widget:" + UUID.randomUUID();
        prefs.edit().putString(KEY_WIDGET_CLIENT_ID, next).commit();
        return next;
    }

    static void saveWidgetItems(
            Context context, JSONArray calendar, JSONArray notes, JSONArray emails) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String nextCalendarIds = idsFor(calendar);
        String nextNotesIds = idsFor(notes);
        String nextEmailsIds = idsFor(emails);
        String seenCalendar = prefs.getString(KEY_SEEN_CALENDAR, "");
        String seenNotes = prefs.getString(KEY_SEEN_NOTES, "");
        String seenEmails = prefs.getString(KEY_SEEN_EMAILS, "");
        boolean firstSync = !prefs.contains(KEY_LAST_SYNC);

        prefs.edit()
                .putString(KEY_CALENDAR, calendar.toString())
                .putString(KEY_NOTES, notes.toString())
                .putString(KEY_EMAILS, emails.toString())
                .putLong(KEY_LAST_SYNC, System.currentTimeMillis())
                .putString(KEY_SEEN_CALENDAR, firstSync ? nextCalendarIds : seenCalendar)
                .putString(KEY_SEEN_NOTES, firstSync ? nextNotesIds : seenNotes)
                .putString(KEY_SEEN_EMAILS, firstSync ? nextEmailsIds : seenEmails)
                .putBoolean(KEY_NEW_CALENDAR, !firstSync && hasNewIds(nextCalendarIds, seenCalendar))
                .putBoolean(KEY_NEW_NOTES, !firstSync && hasNewIds(nextNotesIds, seenNotes))
                .putBoolean(KEY_NEW_EMAILS, !firstSync && hasNewIds(nextEmailsIds, seenEmails))
                .remove(KEY_COMPLETING_NOTES)
                .remove(KEY_DISMISSING_EMAILS)
                .remove(KEY_REFRESH_REQUESTED)
                .remove(KEY_LAST_ERROR)
                .commit();
    }

    static void saveSyncError(Context context, String message) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor =
                prefs.edit()
                        .remove(KEY_COMPLETING_NOTES)
                        .remove(KEY_DISMISSING_EMAILS)
                        .remove(KEY_REFRESH_REQUESTED);
        if (prefs.contains(KEY_LAST_SYNC)) {
            editor.remove(KEY_LAST_ERROR);
        } else {
            editor.putString(KEY_LAST_ERROR, message == null ? "Sync failed" : message);
        }
        editor.commit();
    }

    private static List<WidgetItem> parseItems(String json, String completingIds) {
        List<WidgetItem> items = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(json);
            for (int index = 0; index < array.length() && items.size() < MAX_CACHED_RENDER_ITEMS; index++) {
                JSONObject object = array.optJSONObject(index);
                if (object == null) continue;

                String title = object.optString("title", "").trim();
                if (title.isEmpty()) continue;

                items.add(
                        new WidgetItem(
                                object.optString("id", title),
                                object.optString("kind", "generic"),
                                object.optInt("version", 0),
                                title,
                                object.optString("subtitle", ""),
                                object.optString("metadata", ""),
                                object.optString("accentColor", "#7c3aed"),
                                containsId(completingIds, object.optString("id", ""))));
            }
        } catch (JSONException ignored) {
            return new ArrayList<>();
        }
        return items;
    }

    private static String idsFor(String key, SharedPreferences prefs) {
        try {
            return idsFor(new JSONArray(prefs.getString(key, "[]")));
        } catch (JSONException ignored) {
            return "";
        }
    }

    private static String idsFor(JSONArray array) {
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < array.length(); index++) {
            JSONObject object = array.optJSONObject(index);
            if (object == null) continue;
            String id = object.optString("id", "");
            if (id.isEmpty()) continue;
            if (builder.length() > 0) builder.append(',');
            builder.append(id);
        }
        return builder.toString();
    }

    private static boolean hasNewIds(String nextIds, String seenIds) {
        if (nextIds == null || nextIds.isEmpty()) return false;
        if (seenIds == null || seenIds.isEmpty()) return true;
        String[] ids = nextIds.split(",");
        for (String id : ids) {
            if (!id.isEmpty() && !containsId(seenIds, id)) return true;
        }
        return false;
    }

    private static boolean containsId(String ids, String id) {
        String[] existing = ids.split(",");
        for (String value : existing) {
            if (id.equals(value)) return true;
        }
        return false;
    }

    private static String normalizeTab(String tab) {
        if (TAB_NOTES.equals(tab) || TAB_EMAILS.equals(tab)) return tab;
        return TAB_CALENDAR;
    }

    private static String formatLastSync(long timestamp) {
        return new SimpleDateFormat("h:mma", Locale.US).format(new Date(timestamp)).toLowerCase(Locale.US);
    }

    static final class WidgetState {
        final String activeTab;
        final List<WidgetItem> calendar;
        final List<WidgetItem> notes;
        final List<WidgetItem> emails;
        final String statusText;
        final boolean hasNewCalendar;
        final boolean hasNewNotes;
        final boolean hasNewEmails;

        WidgetState(
                String activeTab,
                List<WidgetItem> calendar,
                List<WidgetItem> notes,
                List<WidgetItem> emails,
                String statusText,
                boolean hasNewCalendar,
                boolean hasNewNotes,
                boolean hasNewEmails) {
            this.activeTab = activeTab;
            this.calendar = calendar;
            this.notes = notes;
            this.emails = emails;
            this.statusText = statusText;
            this.hasNewCalendar = hasNewCalendar;
            this.hasNewNotes = hasNewNotes;
            this.hasNewEmails = hasNewEmails;
        }
    }

    static final class WidgetItem {
        final String id;
        final String kind;
        final int version;
        final String title;
        final String subtitle;
        final String metadata;
        final String accentColor;
        final boolean completing;

        WidgetItem(
                String id,
                String kind,
                int version,
                String title,
                String subtitle,
                String metadata,
                String accentColor,
                boolean completing) {
            this.id = id;
            this.kind = kind;
            this.version = version;
            this.title = title;
            this.subtitle = subtitle;
            this.metadata = metadata;
            this.accentColor = accentColor;
            this.completing = completing;
        }

        boolean isNote() {
            return "note".equals(kind);
        }

        boolean isEmail() {
            return "email".equals(kind);
        }

        boolean isDateHeader() {
            return "date".equals(kind);
        }
    }
}
