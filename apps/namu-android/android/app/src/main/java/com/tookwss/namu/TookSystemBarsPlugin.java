package com.tookwss.namu;

import android.graphics.Color;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "TookSystemBars")
public class TookSystemBarsPlugin extends Plugin {
    @PluginMethod
    public void setSurface(PluginCall call) {
        String top = call.getString("topColor", "");
        String bottom = call.getString("bottomColor", "");
        if (!top.matches("#[0-9a-fA-F]{6}") || !bottom.matches("#[0-9a-fA-F]{6}")) {
            call.reject("invalid_system_bar_color");
            return;
        }
        getActivity().runOnUiThread(() -> {
            ((MainActivity) getActivity()).setSystemBarSurfaces(Color.parseColor(top), Color.parseColor(bottom));
            call.resolve();
        });
    }
}
