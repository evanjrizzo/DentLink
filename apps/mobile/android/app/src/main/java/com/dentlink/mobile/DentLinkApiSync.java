package com.dentlink.mobile;

import android.content.Context;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class DentLinkApiSync {
    static final String DEFAULT_API_BASE = "https://dentlink-api-preview.evanjrizzo.workers.dev";
    private static final int WIDGET_ITEM_LIMIT = 20;
    private static final DateTimeFormatter WIDGET_DATE_HEADER =
            DateTimeFormatter.ofPattern("EEE, MMM d", Locale.US);
    private static final DateTimeFormatter WIDGET_TIME =
            DateTimeFormatter.ofPattern("h:mm a", Locale.US);

    private DentLinkApiSync() {}

    static String loginAndSync(Context context, String apiBase, String email, String password)
            throws IOException, JSONException {
        JSONObject request = new JSONObject();
        request.put("email", email);
        request.put("password", password);

        JSONObject response = requestJson(apiBase, "/v1/auth/login", "POST", null, request);
        String token = response.getJSONObject("session").getString("token");
        DentLinkWidgetStore.saveSession(context, apiBase, token);
        syncWidgetCache(context);
        return token;
    }

    static void syncWidgetCache(Context context) throws IOException, JSONException {
        String token = DentLinkWidgetStore.sessionToken(context);
        if (token == null || token.isEmpty()) {
            throw new IOException("Sign in before syncing");
        }

        String apiBase = DentLinkWidgetStore.apiBase(context);
        String now = Instant.now().toString();
        String max = Instant.now().plus(21, ChronoUnit.DAYS).toString();
        String calendarPath =
                "/v1/calendar/events?timeMin="
                        + encode(now)
                        + "&timeMax="
                        + encode(max)
                        + "&source=all";

        JSONObject calendar = requestJson(apiBase, calendarPath, "GET", token, null);
        JSONObject notifications = requestJson(apiBase, "/v1/notifications", "GET", token, null);
        JSONObject notes = requestJson(apiBase, "/v1/notes", "GET", token, null);
        DentLinkWidgetStore.saveWidgetItems(
                context,
                widgetCalendar(calendar.optJSONArray("events")),
                widgetNotes(notes.optJSONArray("notes")),
                widgetEmails(notifications.optJSONArray("notifications")));
    }

    static void createNote(Context context, String title) throws IOException, JSONException {
        String token = DentLinkWidgetStore.sessionToken(context);
        if (token == null || token.isEmpty()) throw new IOException("Sign in before creating notes");
        JSONObject body = new JSONObject();
        body.put("kind", "task");
        body.put("title", normalizeTitle(title));
        body.put("priority", "none");
        requestJson(DentLinkWidgetStore.apiBase(context), "/v1/notes", "POST", token, body);
        syncWidgetCache(context);
    }

    static void completeNote(Context context, String noteId, int version)
            throws IOException, JSONException {
        String token = DentLinkWidgetStore.sessionToken(context);
        if (token == null || token.isEmpty()) throw new IOException("Sign in before completing notes");
        if (noteId == null || noteId.isEmpty()) throw new IOException("Missing note id");
        JSONObject body = new JSONObject();
        body.put("expectedVersion", version);
        JSONObject patch = new JSONObject();
        patch.put("status", "done");
        body.put("patch", patch);
        requestJson(DentLinkWidgetStore.apiBase(context), "/v1/notes/" + encodePath(noteId), "PATCH", token, body);
        syncWidgetCache(context);
    }

    static void dismissNotification(Context context, String notificationId, int version)
            throws IOException, JSONException {
        String token = DentLinkWidgetStore.sessionToken(context);
        if (token == null || token.isEmpty()) throw new IOException("Sign in before dismissing emails");
        if (notificationId == null || notificationId.isEmpty()) throw new IOException("Missing email id");
        JSONObject body = new JSONObject();
        body.put("expectedVersion", version);
        JSONObject patch = new JSONObject();
        patch.put("status", "dismissed");
        body.put("patch", patch);
        requestJson(
                DentLinkWidgetStore.apiBase(context),
                "/v1/notifications/" + encodePath(notificationId),
                "PATCH",
                token,
                body);
        syncWidgetCache(context);
    }

    private static String normalizeTitle(String title) {
        String value = title == null ? "" : title.trim();
        return value.isEmpty() ? "New note" : value;
    }

    private static JSONArray widgetCalendar(JSONArray eventsSource) throws JSONException {
        List<JSONObject> events = new ArrayList<>();
        String now = Instant.now().toString();
        if (eventsSource != null) {
            for (int index = 0; index < eventsSource.length(); index++) {
                JSONObject event = eventsSource.optJSONObject(index);
                if (event == null) continue;
                if (!"active".equals(event.optString("status"))) continue;
                if (event.optString("endAt", "").compareTo(now) < 0) continue;
                events.add(event);
            }
        }

        events.sort(Comparator.comparing((JSONObject event) -> event.optString("startAt", ""))
                .thenComparing(event -> event.optString("title", "")));

        JSONArray result = new JSONArray();
        String lastDate = "";
        for (int index = 0; index < events.size() && index < WIDGET_ITEM_LIMIT; index++) {
            JSONObject event = events.get(index);
            String date = eventDateKey(event);
            if (!date.equals(lastDate)) {
                JSONObject header = new JSONObject();
                header.put("id", "date-" + date);
                header.put("kind", "date");
                header.put("title", eventDateLabel(date));
                header.put("accentColor", "#7c3aed");
                result.put(header);
                lastDate = date;
            }
            JSONObject item = new JSONObject();
            item.put("id", event.optString("id", "item-" + index));
            item.put("kind", "event");
            item.put("version", event.optInt("version", 0));
            item.put("title", event.optString("title", "Untitled event"));
            item.put("subtitle", "");
            item.put("metadata", eventMetadata(event));
            item.put("accentColor", event.optString("color", "#7c3aed"));
            result.put(item);
        }
        return result;
    }

    private static JSONArray widgetNotes(JSONArray source) throws JSONException {
        List<JSONObject> notes = new ArrayList<>();
        if (source != null) {
            for (int index = 0; index < source.length(); index++) {
                JSONObject note = source.optJSONObject(index);
                if (note == null) continue;
                if (!"active".equals(note.optString("status"))) continue;
                notes.add(note);
            }
        }

        notes.sort(
                Comparator.comparingInt((JSONObject item) -> item.optBoolean("pinned") ? 0 : 1)
                        .thenComparing((JSONObject item) -> -item.optInt("globalOrder", 0))
                        .thenComparing(item -> item.optString("dueAt", "9999-12-31T23:59:59.999Z"))
                        .thenComparing(item -> item.optString("title", "")));

        JSONArray result = new JSONArray();
        for (int index = 0; index < notes.size() && index < WIDGET_ITEM_LIMIT; index++) {
            JSONObject note = notes.get(index);
            JSONObject item = new JSONObject();
            item.put("id", note.optString("id", "note-" + index));
            item.put("kind", "note");
            item.put("version", note.optInt("version", 0));
            item.put("title", note.optString("title", "Untitled note"));
            item.put("subtitle", note.optBoolean("pinned") ? "Pinned note" : "Note");
            item.put("metadata", noteMetadata(note));
            item.put("accentColor", "#7c3aed");
            result.put(item);
        }
        return result;
    }

    private static JSONArray widgetEmails(JSONArray source) throws JSONException {
        List<JSONObject> notifications = new ArrayList<>();
        if (source != null) {
            for (int index = 0; index < source.length(); index++) {
                JSONObject notification = source.optJSONObject(index);
                if (notification == null) continue;
                if (!"active".equals(notification.optString("status"))) continue;
                notifications.add(notification);
            }
        }

        notifications.sort(
                Comparator.comparingInt((JSONObject item) -> item.optBoolean("pinned") ? 0 : 1)
                        .thenComparing((JSONObject item) -> -item.optInt("globalOrder", 0))
                        .thenComparing((JSONObject item) -> -item.optInt("rank", 0))
                        .thenComparing(item -> item.optString("createdAt", ""), Comparator.reverseOrder()));

        JSONArray result = new JSONArray();
        for (int index = 0; index < notifications.size() && index < WIDGET_ITEM_LIMIT; index++) {
            JSONObject notification = notifications.get(index);
            JSONObject email = notification.optJSONObject("email");
            JSONObject item = new JSONObject();
            item.put("id", notification.optString("id", "notification-" + index));
            item.put("kind", "email");
            item.put("version", notification.optInt("version", 0));
            item.put(
                    "title",
                    email != null
                            ? email.optString("subject", notification.optString("title", "Notification"))
                            : notification.optString("title", "Notification"));
            item.put(
                    "subtitle",
                    email != null
                            ? email.optString("senderDisplayName", notification.optString("sourceLabel", ""))
                            : notification.optString("sourceLabel", ""));
            item.put("metadata", emailBodyPreview(notification, email));
            item.put("accentColor", "#7c3aed");
            result.put(item);
        }
        return result;
    }

    private static String eventMetadata(JSONObject event) {
        if (event.optBoolean("allDay")) return "All day";
        String start = localTime(event.optString("startAt", ""));
        String end = localTime(event.optString("endAt", ""));
        if (!start.isEmpty() && !end.isEmpty()) return start + "-" + end;
        return start.isEmpty() ? event.optString("startAt", "") : start;
    }

    private static String emailBodyPreview(JSONObject notification, JSONObject email) {
        String summary = notification.optString("summary", "");
        if (!summary.isEmpty()) return summary;
        String body = notification.optString("body", "");
        if (!body.isEmpty()) return body;
        return email == null ? "" : email.optString("snippet", "");
    }

    private static String localTime(String iso) {
        try {
            ZonedDateTime local = Instant.parse(iso).atZone(ZoneId.systemDefault());
            return local.format(WIDGET_TIME);
        } catch (RuntimeException error) {
            return "";
        }
    }

    private static String eventDateKey(JSONObject event) {
        String start = event.optString("startAt", "");
        if (start.length() >= 10) return start.substring(0, 10);
        return "unscheduled";
    }

    private static String eventDateLabel(String date) {
        if (date.length() == 10) return LocalDate.parse(date).format(WIDGET_DATE_HEADER);
        return "Unscheduled";
    }

    private static String noteMetadata(JSONObject note) {
        String dueAt = note.optString("dueAt", "");
        if (dueAt.length() >= 10) return "Due " + dueAt.substring(5, 10);
        return "Due";
    }

    private static JSONObject requestJson(
            String apiBase, String path, String method, String token, JSONObject body)
            throws IOException, JSONException {
        URL url = new URL(apiBase.replaceAll("/+$", "") + path);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod(method);
        connection.setRequestProperty("Accept", "application/json");
        if (token != null && !token.isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + token);
        }
        if (body != null) {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
        }

        int status = connection.getResponseCode();
        String response = readBody(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
        if (status >= 400) throw new IOException(errorMessage(response, status));
        return new JSONObject(response);
    }

    private static String readBody(InputStream stream) throws IOException {
        if (stream == null) return "";
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader =
                new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) builder.append(line);
        }
        return builder.toString();
    }

    private static String errorMessage(String response, int status) {
        try {
            JSONObject object = new JSONObject(response);
            JSONObject error = object.optJSONObject("error");
            if (error != null) return error.optString("message", "DentLink sync failed");
        } catch (JSONException ignored) {
            return "DentLink sync failed: HTTP " + status;
        }
        return "DentLink sync failed: HTTP " + status;
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String encodePath(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
