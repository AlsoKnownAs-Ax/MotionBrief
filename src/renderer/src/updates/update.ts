import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryClient } from "@renderer/core/connection";
import type { UpdateChannel, UpdateState } from "../../../shared/ipc";

const UPDATE_KEY = ["app-update"];

/** The app update, from main: kept current as updates download and exports start and end in any window. */
export function useUpdateState() {
  useEffect(() => window.motionbrief.onUpdateChanged((state) => queryClient.setQueryData<UpdateState>(UPDATE_KEY, state)), []);

  return useQuery({ queryKey: UPDATE_KEY, queryFn: () => window.motionbrief.getUpdateState(), staleTime: Infinity });
}

export function useSetUpdateChannel() {
  return useMutation({
    mutationFn: (channel: UpdateChannel) => window.motionbrief.setUpdateChannel(channel),
    onSuccess: (state) => queryClient.setQueryData(UPDATE_KEY, state),
  });
}
