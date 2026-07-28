package com.dentlink.mobile;

import android.content.Context;
import android.content.Intent;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.util.ArrayList;
import java.util.List;

public final class DentLinkWidgetRemoteViewsService extends RemoteViewsService {
    private static final String TAG = "DentLinkWidget";

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        String tab =
                intent == null
                        ? DentLinkWidgetStore.TAB_CALENDAR
                        : intent.getStringExtra(DentLinkWidgetProvider.EXTRA_WIDGET_TAB);
        Log.d(
                TAG,
                "factory create tab="
                        + tab
                        + " data="
                        + (intent == null ? null : intent.getData()));
        return new Factory(getApplicationContext(), tab);
    }

    private static final class Factory implements RemoteViewsFactory {
        private final Context context;
        private final String tab;
        private List<DentLinkWidgetStore.WidgetItem> items = new ArrayList<>();

        Factory(Context context, String tab) {
            this.context = context;
            this.tab = tab;
        }

        @Override
        public void onCreate() {
            load();
        }

        @Override
        public void onDataSetChanged() {
            load();
        }

        @Override
        public void onDestroy() {
            items = new ArrayList<>();
        }

        @Override
        public int getCount() {
            return items.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            if (position < 0 || position >= items.size()) return null;
            DentLinkWidgetStore.WidgetItem item = items.get(position);
            if (item.isDateHeader()) {
                RemoteViews views =
                        new RemoteViews(context.getPackageName(), R.layout.dentlink_widget_date_header);
                views.setTextViewText(R.id.widget_date_header, item.title);
                views.setOnClickFillInIntent(
                        R.id.widget_date_header, DentLinkWidgetProvider.noOpFillInIntent());
                return views;
            }
            if (item.isEmail()) return emailView(item);
            if (item.isNote()) return noteView(item);
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.dentlink_widget_item);
            views.setInt(R.id.widget_item_accent, "setBackgroundColor", safeColor(item.accentColor));
            views.setTextViewText(R.id.widget_item_title, item.title);
            views.setTextViewText(R.id.widget_item_subtitle, item.subtitle);
            views.setTextViewText(R.id.widget_item_meta, item.metadata);
            views.setViewVisibility(
                    R.id.widget_item_subtitle,
                    item.subtitle == null || item.subtitle.isEmpty() ? View.GONE : View.VISIBLE);
            views.setViewVisibility(
                    R.id.widget_item_meta,
                    item.metadata == null || item.metadata.isEmpty() ? View.GONE : View.VISIBLE);
            views.setOnClickFillInIntent(R.id.widget_item, DentLinkWidgetProvider.noOpFillInIntent());
            return views;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 4;
        }

        @Override
        public long getItemId(int position) {
            if (position < 0 || position >= items.size()) return position;
            return items.get(position).id.hashCode();
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }

        private void load() {
            DentLinkWidgetStore.WidgetState state = DentLinkWidgetStore.load(context);
            if (DentLinkWidgetStore.TAB_NOTES.equals(tab)) {
                items = state.notes;
            } else if (DentLinkWidgetStore.TAB_EMAILS.equals(tab)) {
                items = state.emails;
            } else {
                items = state.calendar;
            }
            Log.d(
                    TAG,
                    "factory load pinned="
                            + tab
                            + " storeActive="
                            + state.activeTab
                            + " count="
                            + items.size());
        }

        private int safeColor(String color) {
            if (color == null || color.isEmpty()) return android.graphics.Color.rgb(124, 58, 237);
            try {
                return android.graphics.Color.parseColor(color);
            } catch (IllegalArgumentException ignored) {
                return android.graphics.Color.rgb(124, 58, 237);
            }
        }

        private RemoteViews noteView(DentLinkWidgetStore.WidgetItem item) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.dentlink_widget_note_item);
            views.setInt(R.id.widget_note_accent, "setBackgroundColor", safeColor(item.accentColor));
            views.setTextViewText(R.id.widget_note_title, item.title);
            views.setTextViewText(R.id.widget_note_subtitle, item.subtitle);
            views.setTextViewText(R.id.widget_note_meta, item.metadata);
            views.setViewVisibility(
                    R.id.widget_note_subtitle,
                    item.subtitle == null || item.subtitle.isEmpty() ? View.GONE : View.VISIBLE);
            views.setViewVisibility(
                    R.id.widget_note_meta,
                    item.metadata == null || item.metadata.isEmpty() ? View.GONE : View.VISIBLE);
            bindCheckbox(views, R.id.widget_note_checkbox, item.completing);
            Intent completeIntent = DentLinkWidgetProvider.completeNoteFillInIntent(item.id, item.version);
            views.setOnClickFillInIntent(
                    R.id.widget_note_checkbox,
                    completeIntent);
            views.setOnClickFillInIntent(R.id.widget_note_checkbox_zone, completeIntent);
            return views;
        }

        private RemoteViews emailView(DentLinkWidgetStore.WidgetItem item) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.dentlink_widget_email_item);
            views.setInt(R.id.widget_email_accent, "setBackgroundColor", safeColor(item.accentColor));
            views.setTextViewText(R.id.widget_email_title, item.title);
            views.setTextViewText(R.id.widget_email_subtitle, item.subtitle);
            views.setTextViewText(R.id.widget_email_meta, item.metadata);
            views.setViewVisibility(
                    R.id.widget_email_subtitle,
                    item.subtitle == null || item.subtitle.isEmpty() ? View.GONE : View.VISIBLE);
            views.setViewVisibility(
                    R.id.widget_email_meta,
                    item.metadata == null || item.metadata.isEmpty() ? View.GONE : View.VISIBLE);
            bindCheckbox(views, R.id.widget_email_checkbox, item.completing);
            Intent dismissIntent = DentLinkWidgetProvider.dismissEmailFillInIntent(item.id, item.version);
            views.setOnClickFillInIntent(
                    R.id.widget_email_checkbox,
                    dismissIntent);
            views.setOnClickFillInIntent(R.id.widget_email_checkbox_zone, dismissIntent);
            return views;
        }

        private void bindCheckbox(RemoteViews views, int checkboxId, boolean checked) {
            views.setTextViewText(
                    checkboxId,
                    checked
                            ? context.getString(R.string.widget_checkbox_checked)
                            : context.getString(R.string.widget_checkbox_empty));
            views.setTextColor(
                    checkboxId,
                    context.getColor(checked ? R.color.dentlink_accent : R.color.dentlink_text_primary));
        }
    }
}
