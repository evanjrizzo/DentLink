package com.dentlink.mobile;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.ComponentName;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;
import java.util.List;

public final class DentLinkWidgetProvider extends AppWidgetProvider {
    private static final String TAG = "DentLinkWidget";
    static final String ACTION_SWITCH_TAB = "com.dentlink.mobile.widget.SWITCH_TAB";
    static final String ACTION_REFRESH = "com.dentlink.mobile.widget.REFRESH";
    static final String ACTION_AUTO_REFRESH = "com.dentlink.mobile.widget.AUTO_REFRESH";
    static final String ACTION_COMPLETE_NOTE = "com.dentlink.mobile.widget.COMPLETE_NOTE";
    static final String ACTION_DISMISS_EMAIL = "com.dentlink.mobile.widget.DISMISS_EMAIL";
    static final String ACTION_NOOP = "com.dentlink.mobile.widget.NOOP";
    private static final String EXTRA_TAB = "tab";
    private static final String EXTRA_SOURCE = "source";
    static final String EXTRA_NOTE_ID = "note_id";
    static final String EXTRA_NOTE_VERSION = "note_version";
    static final String EXTRA_EMAIL_ID = "email_id";
    static final String EXTRA_EMAIL_VERSION = "email_version";
    static final String EXTRA_WIDGET_TAB = "widget_tab";
    private static final long REFRESH_INTERVAL_MS = 5 * 60 * 1000L;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        Log.d(TAG, "onUpdate ids=" + appWidgetIds.length + " active=" + DentLinkWidgetStore.load(context).activeTab);
        scheduleAutoRefresh(context);
        for (int appWidgetId : appWidgetIds) {
            manager.updateAppWidget(appWidgetId, buildRemoteViews(context, appWidgetId));
            manager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.widget_list);
        }
    }

    @Override
    public void onEnabled(Context context) {
        scheduleAutoRefresh(context);
    }

    @Override
    public void onDisabled(Context context) {
        cancelAutoRefresh(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(
        Context context, AppWidgetManager manager, int appWidgetId, Bundle newOptions) {
        Log.d(TAG, "onOptionsChanged id=" + appWidgetId + " active=" + DentLinkWidgetStore.load(context).activeTab);
        manager.updateAppWidget(appWidgetId, buildRemoteViews(context, appWidgetId));
        manager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.widget_list);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!ACTION_NOOP.equals(action)) {
            scheduleAutoRefresh(context);
        }
        Log.d(
                TAG,
                "onReceive action="
                        + action
                        + " tab="
                        + intent.getStringExtra(EXTRA_TAB)
                        + " source="
                        + intent.getStringExtra(EXTRA_SOURCE)
                        + " data="
                        + intent.getData()
                        + " before="
                        + DentLinkWidgetStore.load(context).activeTab);
        if (ACTION_SWITCH_TAB.equals(action)) {
            DentLinkWidgetStore.setActiveTab(context, intent.getStringExtra(EXTRA_TAB));
            Log.d(TAG, "switch stored active=" + DentLinkWidgetStore.load(context).activeTab);
            updateAllWidgets(context, false);
            return;
        } else if (ACTION_REFRESH.equals(action)) {
            DentLinkWidgetStore.markRefreshRequested(context);
            updateAllWidgets(context, true);
            syncInBackground(context);
            return;
        } else if (ACTION_AUTO_REFRESH.equals(action)) {
            updateAllWidgets(context, true);
            syncInBackground(context);
            return;
        } else if (ACTION_NOOP.equals(action)) {
            Log.d(TAG, "noop handled");
            return;
        } else if (ACTION_COMPLETE_NOTE.equals(action)) {
            DentLinkWidgetStore.markNoteCompleting(context, intent.getStringExtra(EXTRA_NOTE_ID));
            updateAllWidgets(context, true);
            completeNoteInBackground(
                    context, intent.getStringExtra(EXTRA_NOTE_ID), intent.getIntExtra(EXTRA_NOTE_VERSION, 0));
            return;
        } else if (ACTION_DISMISS_EMAIL.equals(action)) {
            DentLinkWidgetStore.markEmailDismissing(context, intent.getStringExtra(EXTRA_EMAIL_ID));
            updateAllWidgets(context, true);
            dismissEmailInBackground(
                    context, intent.getStringExtra(EXTRA_EMAIL_ID), intent.getIntExtra(EXTRA_EMAIL_VERSION, 0));
            return;
        }
        super.onReceive(context, intent);
    }

    static void refreshAllWidgets(Context context) {
        updateAllWidgets(context, true);
    }

    private static void updateAllWidgets(Context context) {
        updateAllWidgets(context, true);
    }

    private static void updateAllWidgets(Context context, boolean notifyListChanged) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName component = new ComponentName(context, DentLinkWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(component);
        Log.d(
                TAG,
                "updateAllWidgets ids="
                        + ids.length
                        + " active="
                        + DentLinkWidgetStore.load(context).activeTab
                        + " notifyList="
                        + notifyListChanged);
        for (int id : ids) {
            Log.d(TAG, "update widget id=" + id);
            manager.updateAppWidget(id, buildRemoteViews(context, id));
            if (notifyListChanged) {
                manager.notifyAppWidgetViewDataChanged(id, R.id.widget_list);
            }
        }
    }

    private static RemoteViews buildRemoteViews(Context context, int appWidgetId) {
        DentLinkWidgetStore.WidgetState state = DentLinkWidgetStore.load(context);
        Log.d(
                TAG,
                "buildRemoteViews id="
                        + appWidgetId
                        + " active="
                        + state.activeTab
                        + " counts calendar="
                        + state.calendar.size()
                        + " notes="
                        + state.notes.size()
                        + " emails="
                        + state.emails.size());
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.dentlink_widget);

        views.setImageViewResource(R.id.widget_logo, R.drawable.dentlink_dark);
        views.setTextViewText(R.id.widget_status, state.statusText);
        views.setOnClickPendingIntent(R.id.widget_logo, openAppIntent(context));
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshIntent(context));
        bindBottomBar(context, views, state);

        List<DentLinkWidgetStore.WidgetItem> items = activeItems(state);
        views.setTextViewText(R.id.widget_empty, emptyText(context, state.activeTab));
        views.setViewVisibility(R.id.widget_empty, items.isEmpty() ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_list, items.isEmpty() ? View.GONE : View.VISIBLE);

        Intent adapterIntent = new Intent(context, DentLinkWidgetRemoteViewsService.class);
        adapterIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        adapterIntent.putExtra(EXTRA_WIDGET_TAB, state.activeTab);
        adapterIntent.setData(Uri.parse("dentlink://widget/" + appWidgetId + "/list/" + state.activeTab));
        views.setRemoteAdapter(R.id.widget_list, adapterIntent);
        views.setPendingIntentTemplate(R.id.widget_list, collectionTemplateIntent(context));

        return views;
    }

    private static void bindBottomBar(
            Context context, RemoteViews views, DentLinkWidgetStore.WidgetState state) {
        bindTab(
                context,
                views,
                R.id.widget_tab_calendar_v2,
                R.id.widget_tab_calendar_icon,
                R.id.widget_tab_calendar_badge,
                DentLinkWidgetStore.TAB_CALENDAR,
                state.activeTab,
                state.hasNewCalendar);
        bindTab(
                context,
                views,
                R.id.widget_tab_notes_v2,
                R.id.widget_tab_notes_icon,
                R.id.widget_tab_notes_badge,
                DentLinkWidgetStore.TAB_NOTES,
                state.activeTab,
                state.hasNewNotes);
        bindTab(
                context,
                views,
                R.id.widget_tab_emails_v2,
                R.id.widget_tab_emails_icon,
                R.id.widget_tab_emails_badge,
                DentLinkWidgetStore.TAB_EMAILS,
                state.activeTab,
                state.hasNewEmails);
        int iconColor = context.getColor(R.color.dentlink_text_primary);
        views.setInt(R.id.widget_create_note_zone, "setBackgroundResource", R.drawable.widget_tab_unselected);
        views.setInt(R.id.widget_create_note, "setColorFilter", iconColor);
        views.setOnClickPendingIntent(R.id.widget_create_note_zone, createNoteIntent(context));
        views.setOnClickPendingIntent(R.id.widget_create_note, createNoteIntent(context));
    }

    private static void bindTab(
            Context context,
            RemoteViews views,
            int tabId,
            int iconId,
            int badgeId,
            String tab,
            String activeTab,
            boolean hasNewContent) {
        boolean selected = tab.equals(activeTab);
        int iconColor =
                context.getColor(
                        selected
                                ? R.color.dentlink_accent_contrast
                                : R.color.dentlink_text_primary);
        views.setInt(iconId, "setColorFilter", iconColor);
        views.setInt(
                tabId,
                "setBackgroundResource",
                selected ? R.drawable.widget_tab_selected : R.drawable.widget_tab_unselected);
        views.setViewVisibility(badgeId, hasNewContent ? View.VISIBLE : View.GONE);
        PendingIntent intent = switchTabIntent(context, tab);
        views.setOnClickPendingIntent(tabId, intent);
        views.setOnClickPendingIntent(iconId, intent);
    }

    private static PendingIntent switchTabIntent(Context context, String tab) {
        Intent intent =
                new Intent(context, DentLinkWidgetProvider.class)
                        .setAction(ACTION_SWITCH_TAB)
                        .setData(Uri.parse("dentlink://widget/tab/" + tab))
                        .putExtra(EXTRA_SOURCE, "bottom_nav")
                        .putExtra(EXTRA_TAB, tab);
        return PendingIntent.getBroadcast(
                context,
                100 + tabOrdinal(tab),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
    }

    private static PendingIntent refreshIntent(Context context) {
        Intent intent =
                new Intent(context, DentLinkWidgetProvider.class)
                        .setAction(ACTION_REFRESH)
                        .setData(Uri.parse("dentlink://widget/refresh"))
                        .putExtra(EXTRA_SOURCE, "refresh");
        return PendingIntent.getBroadcast(
                context,
                200,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
    }

    private static PendingIntent autoRefreshIntent(Context context) {
        Intent intent =
                new Intent(context, DentLinkWidgetProvider.class)
                        .setAction(ACTION_AUTO_REFRESH)
                        .setData(Uri.parse("dentlink://widget/auto-refresh"))
                        .putExtra(EXTRA_SOURCE, "auto_refresh");
        return PendingIntent.getBroadcast(
                context,
                201,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
    }

    private static int tabOrdinal(String tab) {
        if (DentLinkWidgetStore.TAB_NOTES.equals(tab)) return 2;
        if (DentLinkWidgetStore.TAB_EMAILS.equals(tab)) return 3;
        return 1;
    }

    private static PendingIntent createNoteIntent(Context context) {
        Intent intent = new Intent(context, CreateNoteActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
                context, 40, intent, PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
    }

    private static PendingIntent openAppIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
                context, 41, intent, PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
    }

    private static PendingIntent noOpIntent(Context context, int requestCode) {
        Intent intent =
                new Intent(context, DentLinkWidgetProvider.class)
                        .setAction(ACTION_NOOP)
                        .setData(Uri.parse("dentlink://widget/noop/" + requestCode))
                        .putExtra(EXTRA_SOURCE, "noop_" + requestCode);
        return PendingIntent.getBroadcast(
                context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
    }

    private static PendingIntent collectionTemplateIntent(Context context) {
        Intent intent = new Intent(context, DentLinkWidgetProvider.class);
        return PendingIntent.getBroadcast(
                context, 50, intent, PendingIntent.FLAG_UPDATE_CURRENT | mutableFlag());
    }

    static Intent noOpFillInIntent() {
        return new Intent()
                .setAction(ACTION_NOOP)
                .setData(Uri.parse("dentlink://widget/list/noop"))
                .putExtra(EXTRA_SOURCE, "list_item_noop");
    }

    static Intent completeNoteFillInIntent(String noteId, int version) {
        return new Intent()
                .setAction(ACTION_COMPLETE_NOTE)
                .setData(Uri.parse("dentlink://widget/note/" + noteId + "/complete"))
                .putExtra(EXTRA_SOURCE, "note_checkbox")
                .putExtra(EXTRA_NOTE_ID, noteId)
                .putExtra(EXTRA_NOTE_VERSION, version);
    }

    static Intent dismissEmailFillInIntent(String emailId, int version) {
        return new Intent()
                .setAction(ACTION_DISMISS_EMAIL)
                .setData(Uri.parse("dentlink://widget/email/" + emailId + "/dismiss"))
                .putExtra(EXTRA_SOURCE, "email_checkbox")
                .putExtra(EXTRA_EMAIL_ID, emailId)
                .putExtra(EXTRA_EMAIL_VERSION, version);
    }

    private static List<DentLinkWidgetStore.WidgetItem> activeItems(DentLinkWidgetStore.WidgetState state) {
        if (DentLinkWidgetStore.TAB_NOTES.equals(state.activeTab)) return state.notes;
        if (DentLinkWidgetStore.TAB_EMAILS.equals(state.activeTab)) return state.emails;
        return state.calendar;
    }

    private static String emptyText(Context context, String tab) {
        if (DentLinkWidgetStore.TAB_NOTES.equals(tab)) return context.getString(R.string.widget_empty_notes);
        if (DentLinkWidgetStore.TAB_EMAILS.equals(tab)) return context.getString(R.string.widget_empty_emails);
        return context.getString(R.string.widget_empty_calendar);
    }

    private static void syncInBackground(Context context) {
        if (DentLinkWidgetStore.sessionToken(context).isEmpty()) {
            scheduleAutoRefresh(context);
            return;
        }
        Context appContext = context.getApplicationContext();
        new Thread(
                        () -> {
                            try {
                                DentLinkApiSync.refreshWidgetCache(appContext);
                            } catch (Exception error) {
                                DentLinkWidgetStore.saveSyncError(appContext, error.getMessage());
                            }
                            updateAllWidgets(appContext);
                            scheduleAutoRefresh(appContext);
                        })
                .start();
    }

    private static void completeNoteInBackground(Context context, String noteId, int version) {
        Context appContext = context.getApplicationContext();
        new Thread(
                        () -> {
                            try {
                                DentLinkApiSync.completeNote(appContext, noteId, version);
                            } catch (Exception error) {
                                DentLinkWidgetStore.saveSyncError(appContext, error.getMessage());
                            }
                            updateAllWidgets(appContext);
                        })
                .start();
    }

    private static void dismissEmailInBackground(Context context, String emailId, int version) {
        Context appContext = context.getApplicationContext();
        new Thread(
                        () -> {
                            try {
                                DentLinkApiSync.dismissNotification(appContext, emailId, version);
                            } catch (Exception error) {
                                DentLinkWidgetStore.saveSyncError(appContext, error.getMessage());
                            }
                            updateAllWidgets(appContext);
                        })
                .start();
    }

    private static void scheduleAutoRefresh(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        long next = System.currentTimeMillis() + REFRESH_INTERVAL_MS;
        PendingIntent intent = autoRefreshIntent(context);
        alarmManager.cancel(intent);
        alarmManager.cancel(refreshIntent(context));
        if (android.os.Build.VERSION.SDK_INT >= 23) {
            try {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, intent);
            } catch (SecurityException exactAlarmDenied) {
                alarmManager.setWindow(AlarmManager.RTC_WAKEUP, next, REFRESH_INTERVAL_MS / 2, intent);
            }
        } else {
            alarmManager.set(AlarmManager.RTC_WAKEUP, next, intent);
        }
    }

    private static void cancelAutoRefresh(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) {
            alarmManager.cancel(refreshIntent(context));
            alarmManager.cancel(autoRefreshIntent(context));
        }
    }

    private static int immutableFlag() {
        return android.os.Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    private static int mutableFlag() {
        return android.os.Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
    }
}
