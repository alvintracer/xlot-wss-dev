package com.tookwss.namu.nfc;

import android.app.Activity;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.TagLostException;
import android.nfc.tech.IsoDep;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;

@CapacitorPlugin(name = "TookNfcCard")
public final class TookNfcCardPlugin extends Plugin {
    private static final byte[] TOOK_AID = HexFormat.of().parseHex("F0544F4F4B0101");
    private static final HexFormat HEX = HexFormat.of().withLowerCase();
    private static final int DEFAULT_TIMEOUT_MS = 20_000;
    private static final int MIN_TIMEOUT_MS = 3_000;
    private static final int MAX_TIMEOUT_MS = 60_000;
    private static final int ISO_DEP_TIMEOUT_MS = 20_000;

    private final Object pendingLock = new Object();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private NfcAdapter nfcAdapter;
    private PluginCall pendingCall;
    private PendingOperation pendingOperation;
    private boolean processingTag;
    private Runnable timeoutRunnable;

    private enum OperationType {
        SCAN,
        PROVISION_RSA,
        SIGN_ECDSA,
        SIGN_RSA
    }

    private static final class PendingOperation {
        final OperationType type;
        final byte[] expectedCardId;
        final byte[] expectedPublicKey;
        final byte[] expectedRsaModulus;
        final byte[] expectedRsaExponent;
        final byte[] requestId;
        final byte[] digest;
        final byte[] pinDigits;

        private PendingOperation(
            OperationType type,
            byte[] expectedCardId,
            byte[] expectedPublicKey,
            byte[] expectedRsaModulus,
            byte[] expectedRsaExponent,
            byte[] requestId,
            byte[] digest,
            byte[] pinDigits
        ) {
            this.type = type;
            this.expectedCardId = expectedCardId;
            this.expectedPublicKey = expectedPublicKey;
            this.expectedRsaModulus = expectedRsaModulus;
            this.expectedRsaExponent = expectedRsaExponent;
            this.requestId = requestId;
            this.digest = digest;
            this.pinDigits = pinDigits;
        }

        static PendingOperation scan() {
            return new PendingOperation(OperationType.SCAN, null, null, null, null, null, null, null);
        }

        static PendingOperation sign(
            byte[] expectedCardId,
            byte[] expectedPublicKey,
            byte[] requestId,
            byte[] digest,
            byte[] pinDigits
        ) {
            return new PendingOperation(
                OperationType.SIGN_ECDSA,
                expectedCardId,
                expectedPublicKey,
                null,
                null,
                requestId,
                digest,
                pinDigits
            );
        }

        static PendingOperation provisionRsa(byte[] pinDigits) {
            return new PendingOperation(
                OperationType.PROVISION_RSA,
                null,
                null,
                null,
                null,
                null,
                null,
                pinDigits
            );
        }

        static PendingOperation signRsa(
            byte[] expectedCardId,
            byte[] expectedRsaModulus,
            byte[] expectedRsaExponent,
            byte[] requestId,
            byte[] userOpHash,
            byte[] pinDigits
        ) {
            return new PendingOperation(
                OperationType.SIGN_RSA,
                expectedCardId,
                null,
                expectedRsaModulus,
                expectedRsaExponent,
                requestId,
                userOpHash,
                pinDigits
            );
        }

        void clearSecrets() {
            if (pinDigits != null) Arrays.fill(pinDigits, (byte) 0);
        }
    }

    private static final class CardCommandException extends Exception {
        final String code;
        final Integer status;
        final Integer pinTriesRemaining;

        CardCommandException(String message, String code) {
            this(message, code, null, null);
        }

        CardCommandException(String message, String code, Integer status, Integer pinTriesRemaining) {
            super(message);
            this.code = code;
            this.status = status;
            this.pinTriesRemaining = pinTriesRemaining;
        }
    }

    private static final class CardInfo {
        byte[] protocolVersion;
        byte[] appletVersion;
        byte[] cardId;
        int lifecycle = -1;
        Integer pinTriesRemaining;
        Long signatureCounter;
        Long capabilityFlags;
        Boolean pinConfigured;
    }

    private static final class RsaPublicKey {
        final byte[] exponent;
        final byte[] modulus;

        RsaPublicKey(byte[] exponent, byte[] modulus) {
            this.exponent = exponent;
            this.modulus = modulus;
        }
    }

    @Override
    public void load() {
        nfcAdapter = NfcAdapter.getDefaultAdapter(getContext());
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", nfcAdapter != null);
        result.put("enabled", nfcAdapter != null && nfcAdapter.isEnabled());
        call.resolve(result);
    }

    @PluginMethod
    public void scanCard(PluginCall call) {
        startOperation(call, PendingOperation.scan());
    }

    @PluginMethod
    public void provisionRsaCard(PluginCall call) {
        PendingOperation operation;
        try {
            String pin = requireString(call, "pin");
            call.getData().remove("pin");
            operation = PendingOperation.provisionRsa(encodePin(pin));
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage(), "INVALID_ARGUMENT");
            return;
        }
        startOperation(call, operation);
    }

    @PluginMethod
    public void verifyAndSignDigest(PluginCall call) {
        PendingOperation operation;
        try {
            String pin = requireString(call, "pin");
            // Remove the one-time PIN from the retained native call payload as early as possible.
            call.getData().remove("pin");
            byte[] expectedCardId = parseHex(call, "expectedCardIdHex", 16);
            byte[] expectedPublicKey = parsePublicKey(call, "expectedPublicKeyHex");
            byte[] requestId = parseHex(call, "requestIdHex", 16);
            byte[] digest = parseHex(call, "digestHex", 32);
            byte[] pinDigits = encodePin(pin);
            operation = PendingOperation.sign(
                expectedCardId,
                expectedPublicKey,
                requestId,
                digest,
                pinDigits
            );
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage(), "INVALID_ARGUMENT");
            return;
        }
        startOperation(call, operation);
    }

    @PluginMethod
    public void verifyAndSignUserOperation(PluginCall call) {
        PendingOperation operation;
        try {
            String pin = requireString(call, "pin");
            call.getData().remove("pin");
            byte[] expectedCardId = parseHex(call, "expectedCardIdHex", 16);
            byte[] expectedRsaModulus = parseRsaModulus(call, "expectedModulusHex");
            byte[] expectedRsaExponent = parseRsaExponent(call, "expectedExponentHex");
            byte[] requestId = parseHex(call, "requestIdHex", 16);
            byte[] userOpHash = parseHex(call, "userOpHashHex", 32);
            byte[] pinDigits = encodePin(pin);
            operation = PendingOperation.signRsa(
                expectedCardId,
                expectedRsaModulus,
                expectedRsaExponent,
                requestId,
                userOpHash,
                pinDigits
            );
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage(), "INVALID_ARGUMENT");
            return;
        }
        startOperation(call, operation);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelPending("NFC card operation cancelled", "CANCELLED");
        call.resolve();
    }

    private void startOperation(PluginCall call, PendingOperation operation) {
        if (nfcAdapter == null) {
            operation.clearSecrets();
            call.reject("This Android device does not support NFC", "NFC_UNAVAILABLE");
            return;
        }
        if (!nfcAdapter.isEnabled()) {
            operation.clearSecrets();
            call.reject("NFC is disabled", "NFC_DISABLED");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            operation.clearSecrets();
            call.reject("NFC requires a foreground activity", "ACTIVITY_UNAVAILABLE");
            return;
        }

        synchronized (pendingLock) {
            if (pendingCall != null) {
                operation.clearSecrets();
                call.reject("Another NFC card operation is already active", "NFC_BUSY");
                return;
            }
            pendingCall = call;
            pendingOperation = operation;
            processingTag = false;
        }

        int defaultTimeout = operation.type == OperationType.PROVISION_RSA ? MAX_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
        int timeoutMs = normalizedTimeout(call.getInt("timeoutMs", defaultTimeout));
        timeoutRunnable = () -> cancelPending("NFC card operation timed out", "NFC_TIMEOUT");
        mainHandler.postDelayed(timeoutRunnable, timeoutMs);

        Bundle extras = new Bundle();
        extras.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 150);
        int flags = NfcAdapter.FLAG_READER_NFC_A
            | NfcAdapter.FLAG_READER_NFC_B
            | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK
            | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;
        activity.runOnUiThread(() -> {
            try {
                nfcAdapter.enableReaderMode(activity, this::onTagDiscovered, flags, extras);
            } catch (RuntimeException error) {
                rejectPending(call, operation, "Unable to start NFC reader mode", "NFC_START_FAILED", error, null);
            }
        });
    }

    private void onTagDiscovered(Tag tag) {
        PluginCall call;
        PendingOperation operation;
        synchronized (pendingLock) {
            if (pendingCall == null || pendingOperation == null || processingTag) return;
            processingTag = true;
            call = pendingCall;
            operation = pendingOperation;
        }

        IsoDep isoDep = IsoDep.get(tag);
        if (isoDep == null) {
            rejectPending(call, operation, "The detected tag does not support ISO-DEP", "UNSUPPORTED_TAG", null, null);
            return;
        }

        try {
            isoDep.connect();
            isoDep.setTimeout(operation.type == OperationType.PROVISION_RSA ? MAX_TIMEOUT_MS : ISO_DEP_TIMEOUT_MS);
            selectApplet(isoDep);
            JSObject result;
            if (operation.type == OperationType.SCAN) {
                result = scanCard(isoDep);
            } else if (operation.type == OperationType.PROVISION_RSA) {
                result = provisionRsaCard(isoDep, operation);
            } else if (operation.type == OperationType.SIGN_RSA) {
                result = verifyAndSignRsa(isoDep, operation);
            } else {
                result = verifyAndSign(isoDep, operation);
            }
            resolvePending(call, operation, result);
        } catch (TagLostException error) {
            rejectPending(call, operation, "The card left the NFC field", "TAG_LOST", error, null);
        } catch (CardCommandException error) {
            JSObject data = new JSObject();
            if (error.status != null) data.put("status", String.format("%04X", error.status));
            if (error.pinTriesRemaining != null) data.put("pinTriesRemaining", error.pinTriesRemaining);
            rejectPending(call, operation, error.getMessage(), error.code, error, data);
        } catch (IOException error) {
            rejectPending(call, operation, "NFC card communication failed", "NFC_IO", error, null);
        } catch (RuntimeException error) {
            rejectPending(call, operation, "Malformed NFC card response", "INVALID_CARD_RESPONSE", error, null);
        } finally {
            try {
                isoDep.close();
            } catch (IOException ignored) {
                // The operation has already completed or failed.
            }
        }
    }

    private JSObject scanCard(IsoDep isoDep) throws IOException, CardCommandException {
        CardInfo info = readCardInfo(isoDep);
        RsaPublicKey rsaPublicKey = null;
        try {
            rsaPublicKey = readRsaPublicKey(isoDep);
        } catch (CardCommandException error) {
            if (!isKeyUnavailable(error)) throw error;
        }
        if (rsaPublicKey != null) return cardInfoToJs(info, null, rsaPublicKey);

        byte[] publicKey = null;
        try {
            publicKey = transmitSuccess(isoDep, command(0x80, 0x31, 0, 0, null, 65));
            validatePublicKey(publicKey);
        } catch (CardCommandException error) {
            if (!isKeyUnavailable(error)) throw error;
        }
        return cardInfoToJs(info, publicKey, null);
    }

    private JSObject provisionRsaCard(IsoDep isoDep, PendingOperation operation)
        throws IOException, CardCommandException {
        CardInfo info = readCardInfo(isoDep);
        if (info.pinConfigured == null) {
            throw new CardCommandException("Card protocol does not support resumable RSA provisioning", "UNSUPPORTED_CARD_VERSION");
        }
        if (info.lifecycle == 0x7F) throw new CardCommandException("Card PIN is blocked", "PIN_BLOCKED", 0x6983, 0);
        if (info.lifecycle == 0x02) {
            throw new CardCommandException("This card already contains an RSA wallet key", "CARD_ALREADY_PROVISIONED");
        }
        if (info.lifecycle != 0x00 && info.lifecycle != 0x01) {
            throw new CardCommandException("Card is in an unsupported personalization state", "INVALID_CARD_STATE");
        }

        if (info.lifecycle == 0x00) {
            transmitSuccess(isoDep, command(0x80, 0x20, 0, 0, null, null));
            info.lifecycle = 0x01;
        }

        byte[] pinCommand;
        if (Boolean.TRUE.equals(info.pinConfigured)) {
            pinCommand = command(0x80, 0x22, 0, 0, operation.pinDigits, null);
        } else {
            pinCommand = command(0x80, 0x21, 0, 0, operation.pinDigits, null);
        }
        try {
            transmitSuccess(isoDep, pinCommand);
        } finally {
            Arrays.fill(pinCommand, (byte) 0);
        }

        transmitSuccess(isoDep, command(0x80, 0x32, 0, 0, null, null));
        CardInfo provisioned = readCardInfo(isoDep);
        if (provisioned.lifecycle != 0x02 || !Boolean.TRUE.equals(provisioned.pinConfigured)) {
            throw new CardCommandException("Card did not reach the RSA key-ready state", "INVALID_CARD_STATE");
        }
        RsaPublicKey publicKey = readRsaPublicKey(isoDep);
        return cardInfoToJs(provisioned, null, publicKey);
    }

    private JSObject verifyAndSign(IsoDep isoDep, PendingOperation operation) throws IOException, CardCommandException {
        CardInfo info = readCardInfo(isoDep);
        if (info.cardId == null || !MessageDigest.isEqual(info.cardId, operation.expectedCardId)) {
            throw new CardCommandException("This is not the enrolled took Card", "WRONG_CARD");
        }

        byte[] publicKey = transmitSuccess(isoDep, command(0x80, 0x31, 0, 0, null, 65));
        validatePublicKey(publicKey);
        if (!MessageDigest.isEqual(publicKey, operation.expectedPublicKey)) {
            throw new CardCommandException("The card public key does not match enrollment", "WRONG_CARD_KEY");
        }

        byte[] verifyPinCommand = command(0x80, 0x22, 0, 0, operation.pinDigits, null);
        try {
            transmitSuccess(isoDep, verifyPinCommand);
        } finally {
            Arrays.fill(verifyPinCommand, (byte) 0);
        }
        byte[] signRequest = new byte[48];
        System.arraycopy(operation.requestId, 0, signRequest, 0, 16);
        System.arraycopy(operation.digest, 0, signRequest, 16, 32);
        byte[] response;
        try {
            response = transmitSuccess(isoDep, command(0x80, 0x40, 0, 0, signRequest, 256));
        } finally {
            Arrays.fill(signRequest, (byte) 0);
        }
        if (response.length < 6) throw new CardCommandException("Signature response is too short", "INVALID_CARD_RESPONSE");
        int format = response[4] & 0xFF;
        if (format != 1 && format != 2) throw new CardCommandException("Unsupported signature format", "INVALID_CARD_RESPONSE");
        byte[] signature = Arrays.copyOfRange(response, 5, response.length);
        if (format == 2 && signature.length != 64) {
            throw new CardCommandException("Invalid plain signature length", "INVALID_CARD_RESPONSE");
        }

        JSObject result = new JSObject();
        result.put("cardIdHex", HEX.formatHex(info.cardId));
        result.put("publicKeyHex", HEX.formatHex(publicKey));
        result.put("counter", readUint32(response, 0));
        result.put("format", format == 1 ? "DER" : "PLAIN_RS");
        result.put("signatureHex", HEX.formatHex(signature));
        return result;
    }

    private JSObject verifyAndSignRsa(IsoDep isoDep, PendingOperation operation)
        throws IOException, CardCommandException {
        CardInfo info = readCardInfo(isoDep);
        if (info.cardId == null || !MessageDigest.isEqual(info.cardId, operation.expectedCardId)) {
            throw new CardCommandException("This is not the enrolled took Card", "WRONG_CARD");
        }

        RsaPublicKey publicKey = readRsaPublicKey(isoDep);
        if (!MessageDigest.isEqual(publicKey.modulus, operation.expectedRsaModulus) ||
            !MessageDigest.isEqual(publicKey.exponent, operation.expectedRsaExponent)) {
            throw new CardCommandException("The card RSA public key does not match enrollment", "WRONG_CARD_KEY");
        }

        byte[] verifyPinCommand = command(0x80, 0x22, 0, 0, operation.pinDigits, null);
        try {
            transmitSuccess(isoDep, verifyPinCommand);
        } finally {
            Arrays.fill(verifyPinCommand, (byte) 0);
        }

        byte[] signRequest = new byte[48];
        System.arraycopy(operation.requestId, 0, signRequest, 0, 16);
        System.arraycopy(operation.digest, 0, signRequest, 16, 32);
        byte[] receipt;
        try {
            receipt = transmitSuccess(isoDep, command(0x80, 0x42, 0, 0, signRequest, 6));
        } finally {
            Arrays.fill(signRequest, (byte) 0);
        }
        if (receipt.length != 6 || readUint16(receipt, 4) != 256) {
            throw new CardCommandException("Invalid RSA signature receipt", "INVALID_CARD_RESPONSE");
        }

        byte[] first = transmitSuccess(isoDep, command(0x80, 0x43, 0, 0, null, 128));
        byte[] second = transmitSuccess(isoDep, command(0x80, 0x43, 1, 0, null, 128));
        if (first.length != 128 || second.length != 128) {
            throw new CardCommandException("Invalid RSA signature chunk", "INVALID_CARD_RESPONSE");
        }
        byte[] signature = new byte[256];
        System.arraycopy(first, 0, signature, 0, 128);
        System.arraycopy(second, 0, signature, 128, 128);

        JSObject result = new JSObject();
        result.put("algorithm", "RSA2048_PKCS1_SHA256");
        result.put("cardIdHex", HEX.formatHex(info.cardId));
        result.put("modulusHex", HEX.formatHex(publicKey.modulus));
        result.put("exponentHex", HEX.formatHex(publicKey.exponent));
        result.put("counter", readUint32(receipt, 0));
        result.put("signatureHex", HEX.formatHex(signature));
        return result;
    }

    private RsaPublicKey readRsaPublicKey(IsoDep isoDep) throws IOException, CardCommandException {
        byte[] keyInfo = transmitSuccess(isoDep, command(0x80, 0x33, 0, 0, null, 32));
        if (keyInfo.length != 15 || (keyInfo[0] & 0xFF) != 1 || (keyInfo[1] & 0xFF) != 3 ||
            readUint16(keyInfo, 5) != 256) {
            throw new CardCommandException("Invalid RSA key metadata", "INVALID_CARD_RESPONSE");
        }
        byte[] exponent = Arrays.copyOfRange(keyInfo, 2, 5);
        validateRsaExponent(exponent);
        byte[] first = transmitSuccess(isoDep, command(0x80, 0x34, 0, 0, null, 128));
        byte[] second = transmitSuccess(isoDep, command(0x80, 0x34, 1, 0, null, 128));
        if (first.length != 128 || second.length != 128) {
            throw new CardCommandException("Invalid RSA modulus chunk", "INVALID_CARD_RESPONSE");
        }
        byte[] modulus = new byte[256];
        System.arraycopy(first, 0, modulus, 0, 128);
        System.arraycopy(second, 0, modulus, 128, 128);
        validateRsaModulus(modulus);
        return new RsaPublicKey(exponent, modulus);
    }

    private static boolean isKeyUnavailable(CardCommandException error) {
        return error.status != null && (error.status == 0x6A88 || error.status == 0x6D00);
    }

    private void selectApplet(IsoDep isoDep) throws IOException, CardCommandException {
        transmitSuccess(isoDep, command(0x00, 0xA4, 0x04, 0x00, TOOK_AID, 256));
    }

    private CardInfo readCardInfo(IsoDep isoDep) throws IOException, CardCommandException {
        byte[] data = transmitSuccess(isoDep, command(0x80, 0x10, 0, 0, null, 256));
        CardInfo info = new CardInfo();
        boolean[] seen = new boolean[256];
        for (int offset = 0; offset < data.length;) {
            if (offset + 2 > data.length) throw new CardCommandException("Truncated card-info TLV", "INVALID_CARD_RESPONSE");
            int tag = data[offset++] & 0xFF;
            int length = data[offset++] & 0xFF;
            if (seen[tag]) throw new CardCommandException("Duplicate card-info tag", "INVALID_CARD_RESPONSE");
            seen[tag] = true;
            if (offset + length > data.length) throw new CardCommandException("Truncated card-info value", "INVALID_CARD_RESPONSE");
            byte[] value = Arrays.copyOfRange(data, offset, offset + length);
            offset += length;
            switch (tag) {
                case 0x01 -> info.protocolVersion = requireLength(value, 2, tag);
                case 0x02 -> info.appletVersion = requireLength(value, 3, tag);
                case 0x03 -> info.cardId = requireLength(value, 16, tag);
                case 0x04 -> info.lifecycle = requireLength(value, 1, tag)[0] & 0xFF;
                case 0x05 -> info.pinTriesRemaining = requireLength(value, 1, tag)[0] & 0xFF;
                case 0x07 -> info.signatureCounter = readUint32(requireLength(value, 4, tag), 0);
                case 0x08 -> info.capabilityFlags = readUint32(requireLength(value, 4, tag), 0);
                case 0x09 -> info.pinConfigured = (requireLength(value, 1, tag)[0] & 0x01) != 0;
                default -> {
                    // Unknown card-info tags are ignored for forward compatibility.
                }
            }
        }
        if (info.cardId == null) throw new CardCommandException("Card ID is missing", "INVALID_CARD_RESPONSE");
        return info;
    }

    private static byte[] requireLength(byte[] value, int expected, int tag) throws CardCommandException {
        if (value.length != expected) {
            throw new CardCommandException("Invalid length for card-info tag " + tag, "INVALID_CARD_RESPONSE");
        }
        return value;
    }

    private static JSObject cardInfoToJs(CardInfo info, byte[] publicKey, RsaPublicKey rsaPublicKey) {
        JSObject result = new JSObject();
        result.put("cardIdHex", HEX.formatHex(info.cardId));
        result.put("lifecycle", lifecycleName(info.lifecycle));
        if (info.protocolVersion != null) {
            result.put("protocolVersion", (info.protocolVersion[0] & 0xFF) + "." + (info.protocolVersion[1] & 0xFF));
        }
        if (info.appletVersion != null) {
            result.put(
                "appletVersion",
                (info.appletVersion[0] & 0xFF) + "." + (info.appletVersion[1] & 0xFF) + "." + (info.appletVersion[2] & 0xFF)
            );
        }
        if (info.pinTriesRemaining != null) result.put("pinTriesRemaining", info.pinTriesRemaining);
        if (info.signatureCounter != null) result.put("signatureCounter", info.signatureCounter);
        if (info.capabilityFlags != null) result.put("capabilityFlags", info.capabilityFlags);
        if (info.pinConfigured != null) result.put("pinConfigured", info.pinConfigured);
        if (rsaPublicKey != null) {
            result.put("algorithm", "RSA2048_PKCS1_SHA256");
            result.put("rsaModulusHex", HEX.formatHex(rsaPublicKey.modulus));
            result.put("rsaExponentHex", HEX.formatHex(rsaPublicKey.exponent));
        } else if (publicKey != null) {
            result.put("algorithm", "SECP256K1_ECDSA");
            result.put("publicKeyHex", HEX.formatHex(publicKey));
        }
        return result;
    }

    private static String lifecycleName(int lifecycle) {
        return switch (lifecycle) {
            case 0x00 -> "UNINITIALIZED";
            case 0x01 -> "INITIALIZED";
            case 0x02 -> "KEY_READY";
            case 0x7F -> "LOCKED";
            default -> "UNKNOWN";
        };
    }

    private static byte[] transmitSuccess(IsoDep isoDep, byte[] command) throws IOException, CardCommandException {
        byte[] raw = isoDep.transceive(command);
        if (raw.length < 2) throw new CardCommandException("Response APDU has no status word", "INVALID_CARD_RESPONSE");
        int sw1 = raw[raw.length - 2] & 0xFF;
        int sw2 = raw[raw.length - 1] & 0xFF;
        int status = (sw1 << 8) | sw2;
        if (status != 0x9000) {
            Integer pinTries = (status & 0xFFF0) == 0x63C0 ? status & 0x000F : null;
            String code = pinTries != null ? "PIN_FAILED" : status == 0x6983 ? "PIN_BLOCKED" : "CARD_COMMAND_FAILED";
            throw new CardCommandException("Card command failed", code, status, pinTries);
        }
        return Arrays.copyOf(raw, raw.length - 2);
    }

    private static byte[] command(int cla, int ins, int p1, int p2, byte[] data, Integer le) {
        int dataLength = data == null ? 0 : data.length;
        int length = 4 + (dataLength > 0 ? 1 + dataLength : 0) + (le == null ? 0 : 1);
        byte[] command = new byte[length];
        command[0] = (byte) cla;
        command[1] = (byte) ins;
        command[2] = (byte) p1;
        command[3] = (byte) p2;
        int offset = 4;
        if (dataLength > 0) {
            command[offset++] = (byte) dataLength;
            System.arraycopy(data, 0, command, offset, dataLength);
            offset += dataLength;
        }
        if (le != null) command[offset] = (byte) (le == 256 ? 0 : le);
        return command;
    }

    private void resolvePending(PluginCall call, PendingOperation operation, JSObject result) {
        if (!takePending(call, operation)) return;
        operation.clearSecrets();
        stopReaderMode();
        call.resolve(result);
    }

    private void rejectPending(
        PluginCall call,
        PendingOperation operation,
        String message,
        String code,
        Exception exception,
        JSObject data
    ) {
        if (!takePending(call, operation)) return;
        operation.clearSecrets();
        stopReaderMode();
        call.reject(message, code, exception, data);
    }

    private boolean takePending(PluginCall call, PendingOperation operation) {
        synchronized (pendingLock) {
            if (pendingCall != call || pendingOperation != operation) return false;
            pendingCall = null;
            pendingOperation = null;
            processingTag = false;
            return true;
        }
    }

    private void cancelPending(String message, String code) {
        PluginCall call;
        PendingOperation operation;
        synchronized (pendingLock) {
            call = pendingCall;
            operation = pendingOperation;
            pendingCall = null;
            pendingOperation = null;
            processingTag = false;
        }
        if (operation != null) operation.clearSecrets();
        stopReaderMode();
        if (call != null) call.reject(message, code);
    }

    private void stopReaderMode() {
        Runnable timeout = timeoutRunnable;
        timeoutRunnable = null;
        if (timeout != null) mainHandler.removeCallbacks(timeout);
        Activity activity = getActivity();
        if (nfcAdapter != null && activity != null) {
            activity.runOnUiThread(() -> {
                try {
                    nfcAdapter.disableReaderMode(activity);
                } catch (RuntimeException ignored) {
                    // The activity or adapter may already be paused.
                }
            });
        }
    }

    @Override
    protected void handleOnPause() {
        cancelPending("NFC card operation stopped because the app left the foreground", "APP_PAUSED");
    }

    @Override
    protected void handleOnDestroy() {
        cancelPending("NFC card operation stopped", "PLUGIN_DESTROYED");
    }

    private static int normalizedTimeout(Integer value) {
        int timeout = value == null ? DEFAULT_TIMEOUT_MS : value;
        return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, timeout));
    }

    private static String requireString(PluginCall call, String name) {
        String value = call.getString(name);
        if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " is required");
        return value;
    }

    private static byte[] parseHex(PluginCall call, String name, int expectedLength) {
        String value = requireString(call, name);
        String normalized = value.startsWith("0x") || value.startsWith("0X") ? value.substring(2) : value;
        if (!normalized.matches("[0-9a-fA-F]+") || normalized.length() != expectedLength * 2) {
            throw new IllegalArgumentException(name + " must be exactly " + expectedLength + " hexadecimal bytes");
        }
        return HexFormat.of().parseHex(normalized);
    }

    private static byte[] parsePublicKey(PluginCall call, String name) {
        byte[] key = parseHex(call, name, 65);
        validatePublicKey(key);
        return key;
    }

    private static byte[] parseRsaModulus(PluginCall call, String name) {
        byte[] modulus = parseHex(call, name, 256);
        validateRsaModulus(modulus);
        return modulus;
    }

    private static byte[] parseRsaExponent(PluginCall call, String name) {
        byte[] exponent = parseHex(call, name, 3);
        validateRsaExponent(exponent);
        return exponent;
    }

    private static void validatePublicKey(byte[] publicKey) {
        if (publicKey.length != 65 || publicKey[0] != 0x04) {
            throw new IllegalArgumentException("Expected a 65-byte uncompressed secp256k1 public key");
        }
    }

    private static void validateRsaModulus(byte[] modulus) {
        if (modulus.length != 256 || (modulus[0] & 0x80) == 0 || (modulus[255] & 0x01) == 0) {
            throw new IllegalArgumentException("Expected a full-width odd RSA-2048 modulus");
        }
    }

    private static void validateRsaExponent(byte[] exponent) {
        if (exponent.length != 3 || exponent[0] != 0x01 || exponent[1] != 0x00 || exponent[2] != 0x01) {
            throw new IllegalArgumentException("RSA card exponent must be 65537");
        }
    }

    private static byte[] encodePin(String pin) {
        if (!pin.matches("[0-9]{4}")) throw new IllegalArgumentException("Card PIN must contain exactly four decimal digits");
        byte[] digits = new byte[4];
        for (int i = 0; i < pin.length(); i++) digits[i] = (byte) (pin.charAt(i) - '0');
        return digits;
    }

    private static long readUint32(byte[] bytes, int offset) {
        if (offset < 0 || offset + 4 > bytes.length) throw new IllegalArgumentException("Missing uint32 value");
        return ((long) (bytes[offset] & 0xFF) << 24)
            | ((long) (bytes[offset + 1] & 0xFF) << 16)
            | ((long) (bytes[offset + 2] & 0xFF) << 8)
            | (long) (bytes[offset + 3] & 0xFF);
    }

    private static int readUint16(byte[] bytes, int offset) {
        if (offset < 0 || offset + 2 > bytes.length) throw new IllegalArgumentException("Missing uint16 value");
        return ((bytes[offset] & 0xFF) << 8) | (bytes[offset + 1] & 0xFF);
    }
}
