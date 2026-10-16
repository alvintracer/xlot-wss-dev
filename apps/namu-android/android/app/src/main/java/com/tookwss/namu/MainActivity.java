package com.tookwss.namu;

import com.getcapacitor.BridgeActivity;
import com.tookwss.namu.nfc.TookNfcCardPlugin;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowCompat;
import android.graphics.Color;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

public class MainActivity extends BridgeActivity {
    private static final int DEFAULT_TOP_COLOR = Color.rgb(211, 233, 234);
    private static final int DEFAULT_BOTTOM_COLOR = Color.rgb(34, 34, 34);
    private View navigationBarBackdrop;
    private int navigationBarInset;

    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(TookNfcCardPlugin.class);
        registerPlugin(TookSystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
        FrameLayout content = findViewById(android.R.id.content);
        navigationBarBackdrop = new View(this);
        content.addView(navigationBarBackdrop, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.BOTTOM
        ));
        setSystemBarSurfaces(DEFAULT_TOP_COLOR, DEFAULT_BOTTOM_COLOR);

        // Preserve the Namu palette when the device is in dark mode.
        android.webkit.WebView webView = getBridge().getWebView();
        if (webView != null) {
            // Keep the host viewport between transparent Android system bars.
            ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
                int top = insets.getInsets(
                    WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.displayCutout()
                ).top;
                int bottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
                ViewGroup.LayoutParams layoutParams = view.getLayoutParams();
                if (layoutParams instanceof ViewGroup.MarginLayoutParams) {
                    ViewGroup.MarginLayoutParams margins = (ViewGroup.MarginLayoutParams) layoutParams;
                    if (margins.topMargin != top || margins.bottomMargin != bottom) {
                        margins.topMargin = top;
                        margins.bottomMargin = bottom;
                        view.setLayoutParams(margins);
                    }
                }
                if (navigationBarInset != bottom) {
                    navigationBarInset = bottom;
                    FrameLayout.LayoutParams backdrop = (FrameLayout.LayoutParams) navigationBarBackdrop.getLayoutParams();
                    backdrop.height = bottom;
                    navigationBarBackdrop.setLayoutParams(backdrop);
                }
                return insets;
            });
            ViewCompat.requestApplyInsets(webView);
            if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
                WebSettingsCompat.setForceDark(webView.getSettings(), WebSettingsCompat.FORCE_DARK_OFF);
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.getSettings(), false);
            }
        }
    }

    public void setSystemBarSurfaces(int topColor, int bottomColor) {
        findViewById(android.R.id.content).setBackgroundColor(topColor);
        navigationBarBackdrop.setBackgroundColor(bottomColor);
        getWindow().setStatusBarColor(topColor);
        getWindow().setNavigationBarColor(bottomColor);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
            .setAppearanceLightStatusBars(isLight(topColor));
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
            .setAppearanceLightNavigationBars(isLight(bottomColor));
    }

    private static boolean isLight(int color) {
        return (Color.red(color) * 299 + Color.green(color) * 587 + Color.blue(color) * 114) / 1000 >= 150;
    }
}
